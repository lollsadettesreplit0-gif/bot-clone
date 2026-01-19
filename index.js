const { Client } = require('discord.js');
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
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

const client = new Client({
    intents: [
        'Guilds',
        'DirectMessages',
        'MessageContent'
    ]
});

let progress = { channels: {}, stats: { messages: 0, files: 0 } };
let alreadyRan = false;
let githubSha = null;

async function loadProgress() {
    if (GITHUB_TOKEN && GITHUB_REPO) {
        try {
            const res = await axios.get(
                `https://api.github.com/repos/${GITHUB_REPO}/contents/progress.json`,
                { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
            );
            githubSha = res.data.sha;
            progress = JSON.parse(Buffer.from(res.data.content, 'base64').toString());
            console.log(`✅ Loaded from GitHub: ${Object.keys(progress.channels).length} channels`);
            return;
        } catch (err) {
            console.log('📝 First run');
        }
    }

    if (fs.existsSync('progress.json')) {
        progress = JSON.parse(fs.readFileSync('progress.json', 'utf8'));
    }
}

function saveProgress() {
    fs.writeFileSync('progress.json', JSON.stringify(progress, null, 2));
}

async function saveToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;

    try {
        const content = Buffer.from(JSON.stringify(progress, null, 2)).toString('base64');
        const payload = {
            message: `Update: ${progress.stats.messages} msgs, ${progress.stats.files} files`,
            content: content,
            branch: 'main'
        };
        if (githubSha) payload.sha = githubSha;

        const res = await axios.put(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/progress.json`,
            payload,
            { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
        );
        githubSha = res.data.content.sha;
        console.log('✅ GitHub saved');
    } catch (err) {
        console.error('⚠️ GitHub error:', err.message);
    }
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

        // STEP 1: Delete old channels from TARGET
        console.log('🗑️ Deleting old channels...');
        const toDelete = Array.from(target.channels.cache.values());
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

        // STEP 2: Clone categories and channels
        console.log('📁 Cloning structure...');
        const catMap = new Map();
        const cats = source.channels.cache
            .filter(ch => ch.type === 4)
            .sort((a, b) => a.position - b.position);

        for (const cat of cats.values()) {
            const newCat = await target.channels.create({
                name: cat.name,
                type: 4,
                position: cat.position
            }).catch(() => null);

            if (newCat) {
                catMap.set(cat.id, newCat.id);
                console.log(`  ✓ Category: ${cat.name}`);
            }
            await sleep(300);
        }

        // Clone text channels
        for (const [sourceCatId, targetCatId] of catMap.entries()) {
            const textChs = source.channels.cache
                .filter(ch => ch.parentId === sourceCatId && ch.type === 0)
                .sort((a, b) => a.position - b.position);

            for (const ch of textChs.values()) {
                const newCh = await target.channels.create({
                    name: ch.name,
                    type: 0,
                    parent: targetCatId,
                    topic: ch.topic || '',
                    nsfw: true,
                    position: ch.position
                }).catch(() => null);

                if (newCh) {
                    progress.channels[ch.id] = newCh.id;
                    console.log(`  ✓ Channel: ${ch.name}`);
                }
                await sleep(300);
            }

            // Clone voice channels
            const voiceChs = source.channels.cache
                .filter(ch => ch.parentId === sourceCatId && ch.type === 2)
                .sort((a, b) => a.position - b.position);

            for (const ch of voiceChs.values()) {
                await target.channels.create({
                    name: ch.name,
                    type: 2,
                    parent: targetCatId,
                    position: ch.position
                }).catch(() => null);
                console.log(`  ✓ Voice: ${ch.name}`);
                await sleep(300);
            }
        }

        saveProgress();
        console.log('✅ Structure cloned');

        // STEP 3: Copy messages
        console.log('📥 Copying messages...');

        for (const [sourceChId, targetChId] of Object.entries(progress.channels)) {
            if (progress.channels[sourceChId].copied) {
                console.log(`⏭️ #${sourceChId}`);
                continue;
            }

            const sourceCh = source.channels.cache.get(sourceChId);
            const targetCh = target.channels.cache.get(targetChId);

            if (!sourceCh || !targetCh) continue;

            if (!progress.channels[sourceChId]) {
                progress.channels[sourceChId] = { copied: false, lastId: null, count: 0 };
            }

            try {
                console.log(`📂 Copying #${sourceCh.name}...`);
                let lastId = progress.channels[sourceChId].lastId;
                let count = progress.channels[sourceChId].count;

                while (true) {
                    const opts = { limit: 50 };
                    if (lastId) opts.before = lastId;

                    const msgs = await sourceCh.messages.fetch(opts).catch(() => null);
                    if (!msgs || msgs.size === 0) break;

                    const msgsArray = Array.from(msgs.values()).reverse();

                    for (const msg of msgsArray) {
                        try {
                            if (msg.system || msg.author.bot) continue;
                            if (!msg.content && msg.attachments.size === 0 && msg.embeds.length === 0) continue;

                            const files = [];
                            const links = [];

                            for (const att of msg.attachments.values()) {
                                try {
                                    if (att.size > 25000000) {
                                        console.log(`    ⚠️ Too heavy: ${att.name} (${(att.size/1000000).toFixed(2)}MB) - saving link`);
                                        links.push(att.url);
                                        continue;
                                    }
                                    const data = await downloadFile(att.url);
                                    if (data) {
                                        const ext = att.name.split('.').pop();
                                        files.push({ attachment: data, name: `GRINDR.${ext}` });
                                        progress.stats.files++;
                                    }
                                } catch (err) {
                                    console.log(`    ⚠️ Download failed: ${att.name} - saving link`);
                                    links.push(att.url);
                                }
                            }

                            if (files.length > 0) {
                                await targetCh.send({ files: files }).catch(() => {});
                            }

                            if (links.length > 0) {
                                for (const link of links) {
                                    await targetCh.send(link).catch(() => {});
                                    await sleep(300);
                                }
                            }

                            if (msg.embeds.length > 0) {
                                await targetCh.send({ embeds: msg.embeds.slice(0, 10) }).catch(() => {});
                            }

                            if (msg.content && files.length === 0 && links.length === 0) {
                                await targetCh.send({ content: msg.content.slice(0, 2000) }).catch(() => {});
                            }

                            count++;
                            progress.stats.messages++;
                            progress.channels[sourceChId].lastId = msg.id;
                            progress.channels[sourceChId].count = count;
                            saveProgress();

                            if (progress.stats.messages % 20 === 0) {
                                await saveToGitHub();
                            }

                            await sleep(500);

                        } catch (err) {
                            saveProgress();
                            await sleep(2000);
                        }
                    }

                    lastId = msgs.last().id;
                    await sleep(2000);
                }

                progress.channels[sourceChId].copied = true;
                saveProgress();
                await saveToGitHub();

            } catch (err) {
                console.error(`✗ Error: #${sourceCh.name}`);
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

async function downloadFile(url) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 25000000
        });
        return Buffer.from(res.data);
    } catch (err) {
        return null;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

client.login(TOKEN).catch(err => {
    console.error('❌ Login failed:', err.message);
    process.exit(1);
});
