const { Client, GatewayIntentBits, ChannelType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// Variabili globali
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SOURCE_GUILD_ID = process.env.SOURCE_GUILD_ID;
const TARGET_GUILD_ID = process.env.TARGET_GUILD_ID;

const STATE_FILE = 'clone_state.json';
const WEBHOOKS_FILE = 'webhooks.json';

// Avatar invisibile (1x1 pixel trasparente)
const INVISIBLE_AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Limite di upload in MB (Discord limit: 25MB per file)
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return {
        categories: {},
        channels: {},
        webhooks: {},
        cloning: false,
        progress: 0,
        completed: false
    };
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadWebhooks() {
    if (fs.existsSync(WEBHOOKS_FILE)) {
        return JSON.parse(fs.readFileSync(WEBHOOKS_FILE, 'utf8'));
    }
    return {};
}

function saveWebhooks(webhooks) {
    fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(webhooks, null, 2));
}

client.once('ready', async () => {
    console.log(`✅ Bot online come ${client.user.tag}`);
    console.log(`📊 Source Guild: ${SOURCE_GUILD_ID}`);
    console.log(`🎯 Target Guild: ${TARGET_GUILD_ID}`);
    
    const state = loadState();
    
    // Se non è già stato clonato, avvia il processo automaticamente
    if (!state.completed && !state.cloning) {
        console.log('🚀 Avvio clonazione automatica...');
        await startAutomaticClone();
    } else if (state.cloning) {
        console.log('⏳ Ripresa clonazione precedente...');
        await startAutomaticClone();
    } else {
        console.log('✅ Clonazione già completata!');
    }
});

async function startAutomaticClone() {
    const state = loadState();

    const sourceGuild = client.guilds.cache.get(SOURCE_GUILD_ID);
    const targetGuild = client.guilds.cache.get(TARGET_GUILD_ID);

    if (!sourceGuild || !targetGuild) {
        console.error('❌ Guild non trovate!');
        return;
    }

    state.cloning = true;
    state.progress = 0;
    saveState(state);

    console.log(`🔄 Inizio clonazione: ${sourceGuild.name} → ${targetGuild.name}`);

    try {
        // Step 1: Clona categorie
        console.log('📁 STEP 1: Clonando categorie...');
        await cloneCategories(sourceGuild, targetGuild, state);
        await new Promise(r => setTimeout(r, 2000));
        
        // Step 2: Clona canali
        console.log('💬 STEP 2: Clonando canali...');
        await cloneChannels(sourceGuild, targetGuild, state);
        await new Promise(r => setTimeout(r, 2000));
        
        // Step 3: Copia media
        console.log('📸 STEP 3: Copiando media...');
        await copyMedia(sourceGuild, targetGuild, state);
        await new Promise(r => setTimeout(r, 2000));
        
        // Step 4: Crea webhook
        console.log('🪝 STEP 4: Creando webhook...');
        await createWebhooks(targetGuild, state);

        state.cloning = false;
        state.completed = true;
        saveState(state);

        console.log('✅ CLONAZIONE COMPLETATA!');
        console.log(`📊 Risultati:`);
        console.log(`   - Categorie: ${Object.keys(state.categories).length}`);
        console.log(`   - Canali: ${Object.keys(state.channels).length}`);
        console.log(`   - Webhook: ${Object.keys(state.webhooks).length}`);

    } catch (error) {
        console.error('❌ Errore clonazione:', error);
        state.cloning = false;
        saveState(state);
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Comando: !status
    if (message.content === '!status') {
        const state = loadState();
        const webhooks = loadWebhooks();
        
        const embed = new EmbedBuilder()
            .setColor('#667eea')
            .setTitle('📊 Status Clonazione')
            .addFields(
                { name: 'Completata', value: state.completed ? '✅ Sì' : '❌ No', inline: true },
                { name: 'In corso', value: state.cloning ? 'Sì' : 'No', inline: true },
                { name: 'Categorie', value: Object.keys(state.categories).length.toString(), inline: true },
                { name: 'Canali', value: Object.keys(state.channels).length.toString(), inline: true },
                { name: 'Webhook', value: Object.keys(webhooks).length.toString(), inline: true }
            );

        message.reply({ embeds: [embed] });
    }

    // Comando: !webhooks
    if (message.content === '!webhooks') {
        const webhooks = loadWebhooks();
        const list = Object.entries(webhooks)
            .map(([id, data]) => `🪝 ${data.channel_name}`)
            .join('\n');

        const embed = new EmbedBuilder()
            .setColor('#667eea')
            .setTitle('🪝 Webhook Disponibili')
            .setDescription(list || 'Nessun webhook creato');

        message.reply({ embeds: [embed] });
    }

    // Comando: !reset (resetta e riavvia)
    if (message.content === '!reset') {
        const state = loadState();
        state.completed = false;
        state.cloning = false;
        state.categories = {};
        state.channels = {};
        state.webhooks = {};
        saveState(state);
        
        message.reply('🔄 Reset completato! Riavvia il bot per clonare di nuovo.');
    }
});

async function cloneCategories(sourceGuild, targetGuild, state) {
    for (const category of sourceGuild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).values()) {
        try {
            const newCategory = await targetGuild.channels.create({
                name: category.name,
                type: ChannelType.GuildCategory,
                permissionOverwrites: category.permissionOverwrites
            });

            state.categories[category.id] = newCategory.id;
            console.log(`   ✅ ${category.name}`);
            await new Promise(r => setTimeout(r, 800));

        } catch (error) {
            console.error(`   ❌ ${category.name}: ${error.message}`);
        }
    }
    console.log(`✅ Categorie completate: ${Object.keys(state.categories).length}`);
}

async function cloneChannels(sourceGuild, targetGuild, state) {
    for (const channel of sourceGuild.channels.cache.values()) {
        if (channel.type === ChannelType.GuildCategory) continue;

        try {
            const parentId = channel.parentId ? state.categories[channel.parentId] : null;

            if (channel.type === ChannelType.GuildText) {
                const newChannel = await targetGuild.channels.create({
                    name: channel.name,
                    type: ChannelType.GuildText,
                    parent: parentId,
                    topic: channel.topic,
                    nsfw: true
                });

                state.channels[channel.id] = newChannel.id;
                console.log(`   ✅ #${channel.name} (NSFW)`);

            } else if (channel.type === ChannelType.GuildVoice) {
                const newChannel = await targetGuild.channels.create({
                    name: channel.name,
                    type: ChannelType.GuildVoice,
                    parent: parentId
                });

                state.channels[channel.id] = newChannel.id;
                console.log(`   ✅ 🎤 ${channel.name}`);
            }

            await new Promise(r => setTimeout(r, 800));

        } catch (error) {
            console.error(`   ❌ ${channel.name}: ${error.message}`);
        }
    }
    console.log(`✅ Canali completati: ${Object.keys(state.channels).length}`);
}

async function copyMedia(sourceGuild, targetGuild, state) {
    let totalMedia = 0;
    let largeFiles = 0;

    for (const [sourceId, targetId] of Object.entries(state.channels)) {
        const sourceChannel = sourceGuild.channels.cache.get(sourceId);
        const targetChannel = targetGuild.channels.cache.get(targetId);

        if (!sourceChannel || !targetChannel || sourceChannel.type !== ChannelType.GuildText) continue;

        try {
            let count = 0;
            const messages = await sourceChannel.messages.fetch({ limit: 100 });

            for (const message of messages.values()) {
                for (const attachment of message.attachments.values()) {
                    if (attachment.contentType?.startsWith('image/') || attachment.contentType?.startsWith('video/')) {
                        try {
                            const fileExt = attachment.name.split('.').pop() || 'mp4';
                            const fileName = `GRINDR.${fileExt}`;
                            const fileSize = attachment.size;

                            // Se il file è troppo grande (>25MB), invia come link
                            if (fileSize > MAX_FILE_SIZE) {
                                largeFiles++;
                                const embed = new EmbedBuilder()
                                    .setColor('#f04747')
                                    .setTitle(`📥 ${fileName}`)
                                    .setDescription(`[Scarica file (${(fileSize / 1024 / 1024).toFixed(2)}MB)](${attachment.url})`)
                                    .setFooter({ text: 'File troppo grande per caricamento diretto' });

                                await targetChannel.send({ embeds: [embed] });
                                console.log(`   📥 Link: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);

                            } else {
                                // File piccolo, carica direttamente
                                const fileBuffer = await axios.get(attachment.url, { 
                                    responseType: 'arraybuffer',
                                    timeout: 30000
                                });

                                await targetChannel.send({
                                    files: [{
                                        attachment: fileBuffer.data,
                                        name: fileName
                                    }]
                                });

                                console.log(`   ✅ ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
                            }

                            count++;
                            totalMedia++;
                            await new Promise(r => setTimeout(r, 500));

                        } catch (error) {
                            console.error(`   ❌ Errore media: ${error.message}`);
                        }
                    }
                }
            }

            if (count > 0) {
                console.log(`   📸 Canale ${sourceChannel.name}: ${count} media`);
            }

        } catch (error) {
            console.error(`   ❌ Errore ${sourceChannel.name}: ${error.message}`);
        }

        await new Promise(r => setTimeout(r, 1500));
    }
    
    console.log(`✅ Media completati: ${totalMedia} (${largeFiles} come link)`);
}

async function createWebhooks(targetGuild, state) {
    const webhooks = loadWebhooks();
    let webhookCount = 0;

    for (const channel of targetGuild.channels.cache.values()) {
        if (channel.type !== ChannelType.GuildText) continue;

        try {
            const webhook = await channel.createWebhook({
                name: 'GRINDR UPLOADERS',
                avatar: INVISIBLE_AVATAR
            });

            webhooks[channel.id] = {
                url: webhook.url,
                channel_name: channel.name,
                webhook_id: webhook.id
            };

            console.log(`   🪝 #${channel.name}`);
            webhookCount++;
            await new Promise(r => setTimeout(r, 500));

        } catch (error) {
            console.error(`   ❌ ${channel.name}: ${error.message}`);
        }
    }

    saveWebhooks(webhooks);
    console.log(`✅ Webhook completati: ${webhookCount}`);
}

client.login(DISCORD_TOKEN);
