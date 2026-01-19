const { Client, ChannelType } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const http = require('http');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord cloner running!');
}).listen(PORT);

const TOKEN = process.env.DISCORD_TOKEN;
const SOURCE_ID = process.env.SOURCE_GUILD_ID;
const TARGET_ID = process.env.TARGET_GUILD_ID;

const client = new Client({
    intents: [
        'Guilds',
        'DirectMessages',
        'MessageContent'
    ]
});

let progress = { channels: {}, stats: { messages: 0, files: 0 } };
let alreadyRan = false;

async function loadProgress() {
    if (fs.existsSync('progress.json')) {
        progress = JSON.parse(fs.readFileSync('progress.json', 'utf8'));
        console.log('📝 Loaded progress');
    }
}

function saveProgress() {
    fs.writeFileSync('progress.json', JSON.stringify(progress, null, 2));
}

client.on('ready', async () => {
    if (alreadyRan) return;
    alreadyRan = true;

    console.log(`✅ Bot: ${client.user.tag}`);

    const source = client.guilds.cache.get(SOURCE_ID);
    const target = client.guilds.cache.get(TARGET_ID);

    if (!source || !target) {
        console.error('❌ Servers not found');
        process.exit(1);
    }

    await loadProgress();

    try {
        console.log('🎯 CLONING SERVER');

        // STEP 0: Delete all channels only on FIRST run
        if (Object.keys(progress.channels).length === 0) {
            console.log('🗑️  Deleting old channels...');
            const toDelete = Array.from(source.channels.cache.values());
            for (const ch of toDelete) {
                try {
                    await ch.delete();
                    console.log(`  ✓ Deleted: ${ch.name}`);
                    await sleep(300);
                } catch (err) {
                    console.error(`  ✗ Error: ${ch.name}`);
                }
            }
            await sleep(2000);
            console.log('✅ Deletion complete');
        }

        // STEP 1: Clone structure
        if (Object.keys(progress.channels).length === 0) {
            console.log('📁 Cloning structure...');
            const catMap = new Map();
            const cats = target.channels.cache
                .filter(ch => ch.type === ChannelType.GuildCategory)
                .sort((a, b) => a.position - b.position);

            for (const cat of cats.values()) {
                const newCat = await source.channels.create({
                    name: cat.name,
                    type: ChannelType.GuildCategory,
                    position: cat.position
                }).catch(() => null);

                if (newCat) {
                    catMap.set(cat.id, newCat.id);
                    console.log(`  ✓ Category: ${cat.name}`);
                }
                await sleep(300);
            }

            // Clone text channels
            for (const [targetCatId, sourceCatId] of catMap.entries()) {
                const textChs = target.channels.cache
                    .filter(ch => ch.parentId === targetCatId && ch.type === ChannelType.GuildText)
                    .sort((a, b) => a.position - b.position);

                for (const ch of textChs.values()) {
                    const newCh = await source.channels.create({
                        name: ch.name,
                        type: ChannelType.GuildText,
                        parent: sourceCatId,
                        nsfw: true,
                        position: ch.position
                    }).catch(() => null);

                    if (newCh) {
                        progress.channels[ch.id] = newCh.id;
                        console.log(`  ✓ Channel: ${ch.name} (NSFW)`);
                    }
                    await sleep(300);
                }

                // Clone voice channels
                const voiceChs = target.channels.cache
                    .filter(ch => ch.parentId === targetCatId && ch.type === ChannelType.GuildVoice)
                    .sort((a, b) => a.position - b.position);

                for (const ch of voiceChs.values()) {
                    await source.channels.create({
                        name: ch.name,
                        type: ChannelType.GuildVoice,
                        parent: sourceCatId,
                        position: ch.position
                    }).catch(() => null);
                    console.log(`  ✓ Voice: ${ch.name}`);
                    await sleep(300);
                }
            }

            saveProgress();
            console.log('✅ Structure cloned');
        } else {
            console.log('✅ Structure already exists, skipping...');
        }

        // STEP 2: Copy messages with GRINDR.MP4 links (NO EMBEDS)
        console.log('📥 Copying messages...');

        for (const [targetChId, sourceChId] of Object.entries(progress.channels)) {
            if (typeof progress.channels[targetChId] === 'object' && progress.channels[targetChId].copied) {
                console.log(`  ⏭️  Already copied: #${targetChId}`);
                continue;
            }

            const targetCh = target.channels.cache.get(targetChId);
            const sourceCh = source.channels.cache.get(sourceChId);

            if (!targetCh || !sourceCh) continue;

            if (typeof progress.channels[targetChId] !== 'object') {
                progress.channels[targetChId] = { copied: false, lastId: null, count: 0 };
            }

            try {
                console.log(`  📂 Copying #${targetCh.name}...`);
                let lastId = progress.channels[targetChId].lastId;
                let count = progress.channels[targetChId].count;

                while (true) {
                    const opts = { limit: 50 };
                    if (lastId) opts.before = lastId;

                    const msgs = await targetCh.messages.fetch(opts).catch(() => null);
                    if (!msgs || msgs.size === 0) break;

                    const msgsArray = Array.from(msgs.values()).reverse();

                    for (const msg of msgsArray) {
                        try {
                            if (msg.system || msg.author.bot) continue;
                            if (!msg.content && msg.attachments.size === 0 && msg.embeds.length === 0) continue;

                            let messageContent = '';

                            // Aggiungi il testo del messaggio
                            if (msg.content) {
                                messageContent += msg.content + '\n';
                            }

                            // Aggiungi i link ai file come [GRINDR.MP4](url) SENZA EMBED
                            for (const att of msg.attachments.values()) {
                                try {
                                    const ext = att.name.split('.').pop() || 'mp4';
                                    const fileName = `GRINDR.${ext.toUpperCase()}`;
                                    
                                    // Formato: [GRINDR.MP4](url) - NO EMBED
                                    messageContent += `[${fileName}](${att.url})\n`;
                                    progress.stats.files++;
                                } catch (err) {
                                    console.log(`    ⚠️  Error: ${att.name}`);
                                }
                            }

                            // Invia il messaggio se ha contenuto
                            if (messageContent.trim()) {
                                await sourceCh.send({ 
                                    content: messageContent.slice(0, 2000) 
                                }).catch(() => {});
                            }

                            count++;
                            progress.stats.messages++;
                            progress.channels[targetChId].lastId = msg.id;
                            progress.channels[targetChId].count = count;
                            saveProgress();

                            await sleep(500);

                        } catch (err) {
                            saveProgress();
                            await sleep(2000);
                        }
                    }

                    lastId = msgs.last().id;
                    await sleep(2000);
                }

                progress.channels[targetChId].copied = true;
                saveProgress();

            } catch (err) {
                console.error(`  ✗ Error: #${targetCh.name}`);
                saveProgress();
            }

            await sleep(1000);
        }

        console.log('');
        console.log('═════════════════════════════════');
        console.log('✅ CLONE COMPLETE!');
        console.log('═════════════════════════════════');
        console.log(`Messages: ${progress.stats.messages}`);
        console.log(`Files: ${progress.stats.files}`);
        console.log('═════════════════════════════════');

        process.exit(0);

    } catch (err) {
        console.error('❌ Error:', err);
        saveProgress();
        process.exit(1);
    }
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

client.login(TOKEN).catch(err => {
    console.error('❌ Login failed:', err.message);
    process.exit(1);
});
