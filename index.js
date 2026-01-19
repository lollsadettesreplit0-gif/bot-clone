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
    console.log(`📊 SOURCE: ${SOURCE_ID}`);
    console.log(`🎯 TARGET: ${TARGET_ID}`);

    const source = client.guilds.cache.get(SOURCE_ID);
    const target = client.guilds.cache.get(TARGET_ID);

    if (!source || !target) {
        console.error('❌ Servers not found');
        process.exit(1);
    }

    console.log(`Source Guild: ${source.name}`);
    console.log(`Target Guild: ${target.name}`);

    await loadProgress();

    try {
        console.log('\n🎯 CLONING SERVER\n');

        // STEP 0: Delete all channels only on FIRST run
        if (Object.keys(progress.channels).length === 0) {
            console.log('🗑️  Deleting old channels in SOURCE...');
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
            console.log('✅ Deletion complete\n');
        }

        // STEP 1: Clone structure
        if (Object.keys(progress.channels).length === 0) {
            console.log('📁 STEP 1: Cloning structure...\n');
            const catMap = new Map();
            const cats = target.channels.cache
                .filter(ch => ch.type === ChannelType.GuildCategory)
                .sort((a, b) => a.position - b.position);

            console.log(`Found ${cats.size} categories in TARGET`);

            for (const cat of cats.values()) {
                try {
                    const newCat = await source.channels.create({
                        name: cat.name,
                        type: ChannelType.GuildCategory,
                        position: cat.position
                    });

                    catMap.set(cat.id, newCat.id);
                    console.log(`  ✓ Category: ${cat.name}`);
                    await sleep(300);
                } catch (err) {
                    console.error(`  ✗ Error creating category ${cat.name}: ${err.message}`);
                }
            }

            // Clone text channels
            console.log('\nCloning TEXT channels...');
            for (const [targetCatId, sourceCatId] of catMap.entries()) {
                const textChs = target.channels.cache
                    .filter(ch => ch.parentId === targetCatId && ch.type === ChannelType.GuildText)
                    .sort((a, b) => a.position - b.position);

                for (const ch of textChs.values()) {
                    try {
                        const newCh = await source.channels.create({
                            name: ch.name,
                            type: ChannelType.GuildText,
                            parent: sourceCatId,
                            nsfw: true,
                            position: ch.position
                        });

                        progress.channels[ch.id] = { sourceId: newCh.id, copied: false };
                        console.log(`  ✓ Channel: #${ch.name} (NSFW)`);
                        await sleep(300);
                    } catch (err) {
                        console.error(`  ✗ Error creating channel ${ch.name}: ${err.message}`);
                    }
                }
            }

            // Clone voice channels
            console.log('\nCloning VOICE channels...');
            for (const [targetCatId, sourceCatId] of catMap.entries()) {
                const voiceChs = target.channels.cache
                    .filter(ch => ch.parentId === targetCatId && ch.type === ChannelType.GuildVoice)
                    .sort((a, b) => a.position - b.position);

                for (const ch of voiceChs.values()) {
                    try {
                        await source.channels.create({
                            name: ch.name,
                            type: ChannelType.GuildVoice,
                            parent: sourceCatId,
                            position: ch.position
                        });
                        console.log(`  ✓ Voice: ${ch.name}`);
                        await sleep(300);
                    } catch (err) {
                        console.error(`  ✗ Error creating voice ${ch.name}: ${err.message}`);
                    }
                }
            }

            saveProgress();
            console.log('\n✅ Structure cloned\n');
        } else {
            console.log('✅ Structure already exists, skipping...\n');
        }

        // STEP 2: Copy messages with GRINDR.MP4 links (NO EMBEDS)
        console.log('📥 STEP 2: Copying messages...\n');

        for (const [targetChId, chData] of Object.entries(progress.channels)) {
            const targetCh = target.channels.cache.get(targetChId);
            const sourceCh = source.channels.cache.get(chData.sourceId);

            if (!targetCh) {
                console.log(`  ⚠️  Target channel not found: ${targetChId}`);
                continue;
            }

            if (!sourceCh) {
                console.log(`  ⚠️  Source channel not found: ${chData.sourceId}`);
                continue;
            }

            if (chData.copied) {
                console.log(`  ⏭️  Already copied: #${targetCh.name}`);
                continue;
            }

            try {
                console.log(`  📂 Copying #${targetCh.name}...`);
                let lastId = null;
                let count = 0;

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
                                    console.log(`    ⚠️  Error processing: ${att.name}`);
                                }
                            }

                            // Invia il messaggio se ha contenuto
                            if (messageContent.trim()) {
                                await sourceCh.send({ 
                                    content: messageContent.slice(0, 2000) 
                                }).catch((err) => {
                                    console.log(`    ⚠️  Failed to send: ${err.message}`);
                                });
                            }

                            count++;
                            progress.stats.messages++;
                            saveProgress();

                            await sleep(500);

                        } catch (err) {
                            console.log(`    ⚠️  Error processing message: ${err.message}`);
                            saveProgress();
                            await sleep(1000);
                        }
                    }

                    lastId = msgs.last().id;
                    await sleep(2000);
                }

                progress.channels[targetChId].copied = true;
                saveProgress();
                console.log(`     ✅ Done: ${count} messages`);

            } catch (err) {
                console.error(`  ✗ Error: #${targetCh.name} - ${err.message}`);
                saveProgress();
            }

            await sleep(1000);
        }

        console.log('\n');
        console.log('═════════════════════════════════');
        console.log('✅ CLONE COMPLETE!');
        console.log('═════════════════════════════════');
        console.log(`📊 Messages: ${progress.stats.messages}`);
        console.log(`📁 Files: ${progress.stats.files}`);
        console.log('═════════════════════════════════\n');

        process.exit(0);

    } catch (err) {
        console.error('❌ Fatal Error:', err.message);
        console.error(err);
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
