const { Client, ChannelType } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
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
        console.error(`    ❌ Download failed: ${e.message}`);
        return null;
    }
}

client.on('ready', async () => {
    if (started) return;
    started = true;

    const src = client.guilds.cache.get(SOURCE_ID);
    const tgt = client.guilds.cache.get(TARGET_ID);

    if (!src || !tgt) {
        console.error('❌ Servers not found');
        process.exit(1);
    }

    console.log(`\n🎯 Cloning: ${tgt.name} → ${src.name}\n`);

    try {
        // STEP 1: Delete all channels and categories
        console.log('🗑️  STEP 1: Deleting all channels and categories...');
        const allChannels = Array.from(src.channels.cache.values());
        for (const ch of allChannels) {
            try {
                await ch.delete();
                console.log(`  ✓ Deleted: ${ch.name}`);
                await sleep(300);
            } catch (e) {
                console.error(`  ✗ Error: ${ch.name}`);
            }
        }
        console.log('✅ Deletion complete\n');
        await sleep(2000);

        // STEP 2: Clone categories and channels structure
        console.log('📁 STEP 2: Cloning structure...');
        const catMap = new Map();

        // Clone categories
        const categories = Array.from(tgt.channels.cache.values())
            .filter(c => c.type === ChannelType.GuildCategory)
            .sort((a, b) => a.position - b.position);

        for (const cat of categories) {
            try {
                const nc = await src.channels.create({
                    name: cat.name,
                    type: ChannelType.GuildCategory,
                    position: cat.position
                });
                catMap.set(cat.id, nc.id);
                console.log(`  ✓ Category: ${cat.name}`);
                await sleep(300);
            } catch (e) {
                console.error(`  ✗ Category ${cat.name}: ${e.message}`);
            }
        }

        // Clone text channels in categories
        console.log('\n💬 Cloning text channels...');
        for (const [tgtCatId, srcCatId] of catMap.entries()) {
            const textChannels = Array.from(tgt.channels.cache.values())
                .filter(c => c.parentId === tgtCatId && c.type === ChannelType.GuildText)
                .sort((a, b) => a.position - b.position);

            for (const ch of textChannels) {
                try {
                    await src.channels.create({
                        name: ch.name,
                        type: ChannelType.GuildText,
                        parent: srcCatId,
                        nsfw: true,
                        position: ch.position
                    });
                    console.log(`  ✓ #${ch.name} (NSFW)`);
                    await sleep(300);
                } catch (e) {
                    console.error(`  ✗ #${ch.name}: ${e.message}`);
                }
            }
        }

        // Clone voice channels in categories
        console.log('\n🎤 Cloning voice channels...');
        for (const [tgtCatId, srcCatId] of catMap.entries()) {
            const voiceChannels = Array.from(tgt.channels.cache.values())
                .filter(c => c.parentId === tgtCatId && c.type === ChannelType.GuildVoice)
                .sort((a, b) => a.position - b.position);

            for (const ch of voiceChannels) {
                try {
                    await src.channels.create({
                        name: ch.name,
                        type: ChannelType.GuildVoice,
                        parent: srcCatId,
                        position: ch.position
                    });
                    console.log(`  ✓ 🎤 ${ch.name}`);
                    await sleep(300);
                } catch (e) {
                    console.error(`  ✗ ${ch.name}: ${e.message}`);
                }
            }
        }

        console.log('✅ Structure cloned\n');
        await sleep(2000);

        // STEP 3: Copy messages and media
        console.log('📥 STEP 3: Copying messages and media...\n');

        const textChannelMap = new Map();
        for (const [tgtCatId, srcCatId] of catMap.entries()) {
            const tgtTextChs = Array.from(tgt.channels.cache.values())
                .filter(c => c.parentId === tgtCatId && c.type === ChannelType.GuildText);

            for (const tgtCh of tgtTextChs) {
                const srcChs = Array.from(src.channels.cache.values())
                    .filter(c => c.parentId === srcCatId && c.name === tgtCh.name && c.type === ChannelType.GuildText);

                if (srcChs.length > 0) {
                    textChannelMap.set(tgtCh.id, srcChs[0].id);
                }
            }
        }

        let totalMessages = 0;
        let totalFiles = 0;

        for (const [tgtChId, srcChId] of textChannelMap.entries()) {
            const tgtCh = tgt.channels.cache.get(tgtChId);
            const srcCh = src.channels.cache.get(srcChId);

            if (!tgtCh || !srcCh) continue;

            try {
                console.log(`  📂 #${tgtCh.name}`);
                let fileCount = 0;
                let lastId = null;

                while (true) {
                    const msgs = await tgtCh.messages.fetch({
                        limit: 50,
                        ...(lastId && { before: lastId })
                    }).catch(() => null);

                    if (!msgs || msgs.size === 0) break;

                    for (const msg of Array.from(msgs.values()).reverse()) {
                        if (msg.system || msg.author.bot) continue;

                        // ONLY send files, no messages
                        for (const att of msg.attachments.values()) {
                            // Only images and videos
                            if (att.contentType && (att.contentType.startsWith('image/') || att.contentType.startsWith('video/'))) {
                                const ext = att.name.split('.').pop() || 'mp4';
                                const fileName = `GRINDR.${ext}`;
                                
                                console.log(`     ⬇️  ${att.name}`);
                                const fileData = await downloadFile(att.url);
                                
                                if (fileData) {
                                    console.log(`     ⬆️  ${fileName}`);
                                    await srcCh.send({
                                        files: [{
                                            attachment: fileData,
                                            name: fileName
                                        }]
                                    }).catch((e) => {
                                        console.error(`     ❌ Upload failed: ${e.message}`);
                                    });
                                    fileCount++;
                                }
                            }
                        }

                        await sleep(300);
                    }

                    lastId = msgs.last().id;
                    await sleep(1000);
                }

                console.log(`     ✅ ${fileCount} files`);
                totalFiles += fileCount;

            } catch (err) {
                console.error(`  ❌ #${tgtCh.name}: ${err.message}`);
            }

            await sleep(500);
        }

        console.log('\n' + '═'.repeat(40));
        console.log('✅ CLONE COMPLETE!');
        console.log('═'.repeat(40));
        console.log(`📁 Total Files: ${totalFiles}`);
        console.log('═'.repeat(40) + '\n');

        process.exit(0);

    } catch (err) {
        console.error('❌ Fatal Error:', err.message);
        process.exit(1);
    }
});

client.login(TOKEN).catch(err => {
    console.error('❌ Login failed:', err.message);
    process.exit(1);
});
