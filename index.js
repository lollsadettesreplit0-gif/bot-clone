const { Client, GatewayIntentBits, ChannelType, WebhookClient } = require('discord.js');
const { setTimeout } = require('timers/promises');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildWebhooks
    ]
});

const SOURCE_GUILD_ID = process.env.SOURCE_GUILD_ID;
const TARGET_GUILD_ID = process.env.TARGET_GUILD_ID;

// Rate limit safe: 1 richiesta ogni 1.2 secondi
const RATE_LIMIT_DELAY = 1200;
const MESSAGES_PER_BATCH = 10;
const BATCH_DELAY = 5000;

async function safeDelay(ms = RATE_LIMIT_DELAY) {
    await setTimeout(ms);
}

async function deleteAllChannels(guild) {
    console.log(`🚨 ELIMINAZIONE di TUTTI i canali in ${guild.name}...`);
    
    const channels = guild.channels.cache;
    for (const channel of channels.values()) {
        try {
            if (channel.deletable) {
                await channel.delete();
                console.log(`❌ Eliminato: ${channel.name}`);
                await safeDelay();
            }
        } catch (error) {
            console.error(`Errore eliminazione ${channel.name}:`, error.message);
        }
    }
}

async function copyCategory(category, targetGuild) {
    await safeDelay();
    const newCategory = await targetGuild.channels.create({
        name: category.name,
        type: ChannelType.GuildCategory,
        position: category.position,
        nsfw: true,
        reason: 'Clonazione struttura GRINDR'
    });
    
    console.log(`📁 Categoria creata: ${category.name} (NSFW)`);
    return newCategory;
}

async function copyChannel(sourceChannel, targetGuild, parentId = null) {
    await safeDelay();
    
    const channelData = {
        name: sourceChannel.name,
        type: sourceChannel.type,
        nsfw: true,
        topic: sourceChannel.topic ? `${sourceChannel.topic} | GRINDR 18+` : 'GRINDR 18+ CONTENT',
        position: sourceChannel.position,
        parent: parentId,
        reason: 'GRINDR Migration'
    };
    
    const newChannel = await targetGuild.channels.create(channelData);
    console.log(`📺 Canale creato: ${sourceChannel.name} (NSFW 18+)`);
    
    return newChannel;
}

async function createGrindrWebhook(channel) {
    await safeDelay();
    
    try {
        const webhook = await channel.createWebhook({
            name: 'GRINDR UPLOADER',
            avatar: null,
            reason: 'GRINDR Content Migration'
        });
        
        console.log(`🔗 Webhook GRINDR creato in: ${channel.name}`);
        return webhook;
    } catch (error) {
        console.error(`Errore webhook in ${channel.name}:`, error.message);
        return null;
    }
}

async function fetchAllMessages(channel) {
    let messages = [];
    let lastId;
    
    console.log(`📥 Scaricamento messaggi da: ${channel.name}`);
    
    while (true) {
        await safeDelay(1500); // Rate limit extra per fetch messaggi
        
        const options = { limit: 100 };
        if (lastId) options.before = lastId;
        
        const fetched = await channel.messages.fetch(options);
        if (fetched.size === 0) break;
        
        messages.push(...fetched.values());
        lastId = fetched.last().id;
        
        console.log(`  Scaricati ${fetched.size} messaggi da ${channel.name} (totali: ${messages.length})`);
        
        if (fetched.size < 100) break;
    }
    
    // Filtra solo messaggi con video/immagini
    return messages.filter(msg => {
        return msg.attachments.size > 0 && 
               msg.attachments.some(att => 
                   att.contentType?.startsWith('video/') || 
                   att.contentType?.startsWith('image/')
               );
    });
}

async function uploadToWebhook(webhook, messages, sourceChannelName) {
    const webhookClient = new WebhookClient({ url: webhook.url });
    let uploaded = 0;
    
    console.log(`⬆️  Inizio upload da "${sourceChannelName}" via webhook GRINDR...`);
    
    // Processa in batch per rate limit
    for (let i = 0; i < messages.length; i += MESSAGES_PER_BATCH) {
        const batch = messages.slice(i, i + MESSAGES_PER_BATCH);
        
        for (const message of batch) {
            for (const attachment of message.attachments.values()) {
                try {
                    await safeDelay(2000); // Rate limit conservativo per upload
                    
                    await webhookClient.send({
                        content: `GRINDR 🔞 ${attachment.name ? attachment.name.split('.')[0] : 'CONTENT'}`,
                        files: [attachment.url],
                        username: 'GRINDR UPLOADER',
                        avatarURL: 'https://cdn.discordapp.com/attachments/110373943822540800/1217710419994087434/grindr_logo.png'
                    });
                    
                    uploaded++;
                    console.log(`✅ Upload ${uploaded}: "${attachment.name}" -> RINOMINATO "GRINDR"`);
                    
                } catch (error) {
                    console.error(`❌ Errore upload:`, error.message);
                    if (error.code === 429) {
                        const retryAfter = error.retryAfter || 10;
                        console.log(`⏳ Rate limit, aspetto ${retryAfter} secondi...`);
                        await setTimeout(retryAfter * 1000);
                    }
                }
            }
        }
        
        if (i + MESSAGES_PER_BATCH < messages.length) {
            console.log(`♻️  Batch completato. Prossimo batch in ${BATCH_DELAY/1000}s...`);
            await setTimeout(BATCH_DELAY);
        }
    }
    
    webhookClient.destroy();
    return uploaded;
}

client.once('ready', async () => {
    console.log(`🤖 Bot GRINDR pronto: ${client.user.tag}`);
    console.log('⚠️  ATTENZIONE: Operazione DISTRUTTIVA in corso!');
    
    const sourceGuild = await client.guilds.fetch(SOURCE_GUILD_ID);
    const targetGuild = await client.guilds.fetch(TARGET_GUILD_ID);
    
    // 1. ELIMINAZIONE TUTTI CANALI TARGET
    console.log('\n====================== FASE 1 ======================');
    await deleteAllChannels(targetGuild);
    
    // 2. CLONAZIONE STRUTTURA
    console.log('\n====================== FASE 2 ======================');
    const categories = sourceGuild.channels.cache
        .filter(c => c.type === ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position);
    
    const categoryMap = new Map();
    
    // Crea categorie
    for (const category of categories.values()) {
        const newCategory = await copyCategory(category, targetGuild);
        categoryMap.set(category.id, newCategory.id);
    }
    
    // Crea canali
    const channels = sourceGuild.channels.cache
        .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice)
        .sort((a, b) => a.position - b.position);
    
    const channelMap = new Map();
    
    for (const channel of channels.values()) {
        const parentId = channel.parentId ? categoryMap.get(channel.parentId) : null;
        const newChannel = await copyChannel(channel, targetGuild, parentId);
        channelMap.set(channel.id, newChannel);
    }
    
    // 3. CREAZIONE WEBHOOK GRINDR
    console.log('\n====================== FASE 3 ======================');
    const webhookMap = new Map();
    
    for (const [sourceId, targetChannel] of channelMap) {
        const webhook = await createGrindrWebhook(targetChannel);
        if (webhook) {
            webhookMap.set(sourceId, {
                webhook: webhook,
                targetChannel: targetChannel,
                sourceChannel: sourceGuild.channels.cache.get(sourceId)
            });
        }
    }
    
    // 4. UPLOAD CONTENUTI CON WEBHOOK
    console.log('\n====================== FASE 4 ======================');
    console.log('🚀 INIZIO UPLOAD MASSIVO GRINDR!');
    
    let totalUploaded = 0;
    
    for (const [sourceId, data] of webhookMap) {
        const sourceChannel = data.sourceChannel;
        const webhook = data.webhook;
        
        if (sourceChannel && webhook) {
            try {
                const messages = await fetchAllMessages(sourceChannel);
                console.log(`🎬 Trovati ${messages.length} media in "${sourceChannel.name}"`);
                
                if (messages.length > 0) {
                    const uploaded = await uploadToWebhook(webhook, messages, sourceChannel.name);
                    totalUploaded += uploaded;
                    console.log(`📊 Completato: ${uploaded} media da "${sourceChannel.name}"`);
                }
                
                await setTimeout(10000); // Pausa lunga tra canali
                
            } catch (error) {
                console.error(`💥 Errore processando ${sourceChannel.name}:`, error.message);
            }
        }
    }
    
    // 5. COMPLETAMENTO
    console.log('\n====================== FASE 5 ======================');
    console.log(`✅ OPERAZIONE COMPLETATA!`);
    console.log(`📈 Totale media uploadati: ${totalUploaded}`);
    console.log(`🎯 Tutti rinominati: GRINDR`);
    console.log(`🔞 Tutti i canali: NSFW 18+`);
    console.log(`🤖 Bot si ferma.`);
    
    process.exit(0);
});

// Gestione errori
client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.login(process.env.DISCORD_TOKEN);
