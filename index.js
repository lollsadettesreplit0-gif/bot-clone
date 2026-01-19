const { Client, ChannelType } = require('discord.js');
const axios = require('axios');
const http = require('http');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Cloner running');
}).listen(PORT);

const TOKEN = process.env.DISCORD_TOKEN;
const SOURCE_ID = process.env.SOURCE_GUILD_ID;
const TARGET_ID = process.env.TARGET_GUILD_ID;

const client = new Client({ intents: ['Guilds', 'DirectMessages', 'MessageContent'] });
let started = false;

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function downloadFile(url) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 60000,
            maxContentLength: 100000000
        });
        return Buffer.from(res.data);
    } catch (e) {
        return null;
    }
}

client.once('ready', async () => {
    if (started) return;
    started = true;

    console.log(`\n✅ Bot connected: ${client.user.tag}\n`);

    const src = client.guilds.cache.get(SOURCE_ID);
    const tgt = client.guilds.cache.get(TARGET_ID);

    if (!src || !tgt) {
        console.error('❌ SOURCE_ID or TARGET_ID not found');
        process.exit(1);
    }

    console.log(`From: ${tgt.name} (${TARGET_ID})`);
    console.log(`To: ${src.name} (${SOURCE_ID})\n`);

    try {
        // STEP 1: Delete all
        console.log('🗑️  Deleting old channels...');
        console.log(`Checking permissions in: ${src.name}`);
        console.log(`Bot permissions: ${src.me.permissions.toArray().join(', ')}\n`);
        
        if (!src.me.permissions.has('ManageChannels')) {
            console.error('❌ Bot does NOT have ManageChannels permission!');
            process.exit(1);
        }

        let deleted = 0;
        for (const ch of src.channels.cache.values()) {
            try {
                await ch.delete();
                deleted++;
                console.log(`  ✓ Deleted: ${ch.name}`);
                await sleep(300);
            } catch (e) {
                console.log(`  ❌ Error deleting ${ch.name}: ${e.message}`);
            }
        }
        console.log(`✅ Deleted ${deleted} channels\n`);
        await sleep(2000);

        // STEP 2: Clone categories
        console.log('📁 Cloning categories...');
        const catMap = new Map();
        
        const cats = Array.from(tgt.channels.cache.values())
            .filter(c => c.type === ChannelType.GuildCategory);

        for (const cat of cats) {
            try {
                const newCat = await src.channels.create({
                    name: cat.name,
                    type: ChannelType.GuildCategory,
                    position: cat.position
                });
                catMap.set(cat.id, newCat.id);
                console.log(`  ✓ ${cat.name}`);
                await sleep(500);
            } catch (e) {
                console.log(`  ✗ Failed: ${cat.name}`);
            }
        }
        console.log(`✅ Done: ${catMap.size} categories\n`);

        // STEP 3: Clone text channels
        console.log('💬 Cloning text channels...');
        const chMap = new Map();

        const textChs = Array.from(tgt.channels.cache.values())
            .filter(c => c.type === ChannelType.GuildText);

        for (const ch of textChs) {
            try {
                const parentId = ch.parentId ? catMap.get(ch.parentId) : null;
                
                const newCh = await src.channels.create({
                    name: ch.name,
                    type: ChannelType.GuildText,
                    parent: parentId || undefined,
                    nsfw: true,
                    position: ch.position
                });
                chMap.set(ch.id, newCh.id);
                console.log(`  ✓ #${ch.name}`);
                await sleep(500);
            } catch (e) {
                console.log(`  ✗ Failed: ${ch.name}`);
            }
        }
        console.log(`✅ Done: ${chMap.size} text channels\n`);

        // STEP 4: Copy files
        console.log('📥 Copying files...\n');
        let totalFiles = 0;

        for (const [tgtChId, srcChId] of chMap) {
            const tgtCh = tgt.channels.cache.get(tgtChId);
            const srcCh = src.channels.cache.get(srcChId);

            if (!tgtCh || !srcCh) continue;

            try {
                console.log(`  📂 #${tgtCh.name}`);
                let count = 0;
                let lastId = null;

                while (true) {
                    const msgs = await tgtCh.messages.fetch({
                        limit: 50,
                        ...(lastId && { before: lastId })
                    }).catch(() => null);

                    if (!msgs || msgs.size === 0) break;

                    for (const msg of Array.from(msgs.values()).reverse()) {
                        for (const att of msg.attachments.values()) {
                            if (att.contentType && (att.contentType.startsWith('image/') || att.contentType.startsWith('video/'))) {
                                const ext = att.name.split('.').pop() || 'mp4';
                                const fileData = await downloadFile(att.url);

                                if (fileData) {
                                    await srcCh.send({
                                        files: [{
                                            attachment: fileData,
                                            name: `GRINDR.${ext}`
                                        }]
                                    }).catch(() => {});
                                    count++;
                                    totalFiles++;
                                }
                            }
                        }
                        await sleep(200);
                    }

                    lastId = msgs.last().id;
                    await sleep(1000);
                }

                console.log(`     ✅ ${count} files\n`);
            } catch (err) {
                console.log(`  ❌ Error\n`);
            }

            await sleep(500);
        }

        console.log('═'.repeat(40));
        console.log('✅ CLONE COMPLETE!');
        console.log(`📁 Total Files: ${totalFiles}`);
        console.log('═'.repeat(40) + '\n');
        process.exit(0);

    } catch (err) {
        console.error('❌ Fatal Error:', err.message);
        process.exit(1);
    }
});

client.login(TOKEN).catch(err => {
    console.error('❌ Login failed');
    process.exit(1);
});
