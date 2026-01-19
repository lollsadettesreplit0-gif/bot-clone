const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const PREFIX = '$';

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith(PREFIX) || message.author.bot) return;
    
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    if (command === 'copy') {
        if (args.length < 2) {
            return message.reply('Usa: $copy <source_channel_id> <target_channel_id>');
        }
        
        const [sourceId, targetId] = args;
        
        try {
            const sourceChannel = await client.channels.fetch(sourceId);
            const targetChannel = await client.channels.fetch(targetId);
            
            message.reply('🚀 Inizio copia video... Tutti i video saranno rinominati GRINDR!');
            
            let lastId = null;
            let videoCount = 0;
            
            while (true) {
                const options = { limit: 100 };
                if (lastId) options.before = lastId;
                
                const messages = await sourceChannel.messages.fetch(options);
                if (messages.size === 0) break;
                
                // Processa in ordine inverso (dal più vecchio al più nuovo)
                const sortedMessages = Array.from(messages.values()).reverse();
                
                for (const msg of sortedMessages) {
                    // Cerca video nelle attachments
                    for (const attachment of msg.attachments.values()) {
                        if (attachment.contentType?.startsWith('video/') || 
                            attachment.name?.match(/\.(mp4|mov|avi|mkv|webm)$/i)) {
                            
                            // RINOMINA IL VIDEO
                            const originalName = attachment.name || 'video.mp4';
                            const extension = originalName.split('.').pop();
                            const newName = `GRINDR_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${extension}`;
                            
                            console.log(`🔄 Rinomino: ${originalName} -> ${newName}`);
                            
                            // Invia il video rinominato
                            await targetChannel.send({
                                content: `**GRINDR** 🔞 - ${msg.author?.username || 'Unknown'}`,
                                files: [{
                                    attachment: attachment.url,
                                    name: newName // QUI RINOMINI!
                                }]
                            });
                            
                            videoCount++;
                            await delay(2000); // Rate limit
                        }
                    }
                    
                    // Cerca video negli embed
                    if (msg.embeds.length > 0) {
                        for (const embed of msg.embeds) {
                            if (embed.video?.url) {
                                await targetChannel.send({
                                    content: `**GRINDR** 🔞 - Video embed`,
                                    files: [{
                                        attachment: embed.video.url,
                                        name: `GRINDR_embed_${Date.now()}.mp4`
                                    }]
                                });
                                videoCount++;
                                await delay(2000);
                            }
                        }
                    }
                }
                
                lastId = messages.last().id;
                await delay(1000);
                
                if (messages.size < 100) break;
            }
            
            message.reply(`✅ Copia completata! ${videoCount} video rinominati GRINDR!`);
            
        } catch (error) {
            console.error(error);
            message.reply('❌ Errore: ' + error.message);
        }
    }
    
    if (command === 'clone') {
        if (args.length < 2) return message.reply('Usa: $clone <source_id> <target_id>');
        
        const [sourceId, targetId] = args;
        const customName = args[2] || 'GRINDR UPLOADER';
        
        message.reply('🔄 Clonazione in corso... Tutti i video saranno GRINDR!');
        
        try {
            const sourceGuild = await client.guilds.fetch(sourceId);
            const targetGuild = await client.guilds.fetch(targetId);
            
            // 1. Clona categorie
            const categories = sourceGuild.channels.cache.filter(c => c.type === ChannelType.GuildCategory);
            for (const category of categories.values()) {
                await targetGuild.channels.create({
                    name: category.name,
                    type: ChannelType.GuildCategory,
                    nsfw: true
                });
                await delay(1000);
            }
            
            // 2. Clona canali e copia video
            const channels = sourceGuild.channels.cache.filter(c => c.type === ChannelType.GuildText);
            
            for (const sourceChannel of channels.values()) {
                // Crea canale target
                const targetChannel = await targetGuild.channels.create({
                    name: sourceChannel.name,
                    type: ChannelType.GuildText,
                    nsfw: true,
                    topic: sourceChannel.topic ? `${sourceChannel.topic} | GRINDR 18+` : 'GRINDR 18+'
                });
                
                await delay(1000);
                
                // Crea webhook
                const webhook = await targetChannel.createWebhook({
                    name: customName,
                    avatar: args[3] || null
                });
                
                // Copia video con rinomina
                let lastId = null;
                let totalVideos = 0;
                
                while (true) {
                    const options = { limit: 50 };
                    if (lastId) options.before = lastId;
                    
                    const messages = await sourceChannel.messages.fetch(options);
                    if (messages.size === 0) break;
                    
                    // Processa video
                    for (const msg of Array.from(messages.values()).reverse()) {
                        for (const attachment of msg.attachments.values()) {
                            if (attachment.contentType?.startsWith('video/')) {
                                // RINOMINA A GRINDR
                                const ext = attachment.name?.split('.').pop() || 'mp4';
                                const newName = `GRINDR_${totalVideos + 1}.${ext}`;
                                
                                await webhook.send({
                                    content: `**GRINDR** 🔞`,
                                    files: [{
                                        attachment: attachment.url,
                                        name: newName // VIDEO RINOMINATO
                                    }],
                                    username: customName
                                });
                                
                                totalVideos++;
                                await delay(2500); // Rate limit sicuro
                            }
                        }
                    }
                    
                    lastId = messages.last().id;
                    await delay(1500);
                    
                    if (messages.size < 50) break;
                }
                
                console.log(`✅ ${sourceChannel.name}: ${totalVideos} video rinominati GRINDR`);
            }
            
            message.reply('🎯 Clonazione COMPLETATA! Tutti i video sono stati rinominati GRINDR!');
            
        } catch (error) {
            console.error(error);
            message.reply('❌ Errore: ' + error.message);
        }
    }
    
    // Altri comandi rimangono come prima...
});

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

client.once('ready', () => {
    console.log(`✅ Bot GRINDR pronto! Prefix: ${PREFIX}`);
    console.log('📌 Comandi: $copy, $clone, $list, $nsfw, etc.');
    console.log('🎬 Tutti i video saranno rinominati: GRINDR');
});

client.login(process.env.DISCORD_TOKEN);
