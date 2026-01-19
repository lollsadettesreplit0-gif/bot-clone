const { Client, GatewayIntentBits, ChannelType, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs').promises;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildWebhooks
    ]
});

const PREFIX = '$';
let isCopying = false;

// DEBUG LOG
console.log('🤖 Bot starting...');
console.log('Prefix:', PREFIX);

client.on('messageCreate', async (message) => {
    console.log(`📨 Message received: ${message.content}`);
    console.log(`👤 From: ${message.author.tag}`);
    console.log(`🏠 Guild: ${message.guild?.name}`);
    
    if (message.author.bot) {
        console.log('🤖 Ignoring bot message');
        return;
    }
    
    if (!message.content.startsWith(PREFIX)) {
        console.log('❌ Not a command');
        return;
    }
    
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    console.log(`⚡ Command: ${command}`);
    console.log(`📝 Args: ${args}`);
    
    // COMANDO DI TEST
    if (command === 'test') {
        console.log('✅ Test command received');
        await message.reply('✅ Bot is working! GRINDR ready.');
        return;
    }
    
    // COMANDO COPY
    if (command === 'copy') {
        if (isCopying) {
            await message.reply('❌ Already copying! Use `$stop copy` first.');
            return;
        }
        
        if (args.length < 2) {
            await message.reply('❌ Usage: `$copy <source_channel_id> <target_channel_id>`');
            return;
        }
        
        const [sourceId, targetId] = args;
        
        console.log(`🎯 Copy from ${sourceId} to ${targetId}`);
        await message.reply(`🚀 Starting copy... Videos will be renamed to GRINDR!`);
        
        isCopying = true;
        
        try {
            const sourceChannel = await client.channels.fetch(sourceId);
            const targetChannel = await client.channels.fetch(targetId);
            
            console.log(`✅ Channels fetched:`);
            console.log(`   Source: ${sourceChannel.name} (${sourceChannel.id})`);
            console.log(`   Target: ${targetChannel.name} (${targetChannel.id})`);
            
            let lastId = null;
            let videoCount = 0;
            let messageCount = 0;
            
            while (true && isCopying) {
                const options = { limit: 50 };
                if (lastId) options.before = lastId;
                
                console.log(`📥 Fetching messages... (before: ${lastId || 'none'})`);
                const messages = await sourceChannel.messages.fetch(options);
                console.log(`📨 Got ${messages.size} messages`);
                
                if (messages.size === 0) {
                    console.log('✅ No more messages');
                    break;
                }
                
                const sortedMessages = Array.from(messages.values()).reverse();
                
                for (const msg of sortedMessages) {
                    if (!isCopying) break;
                    
                    messageCount++;
                    console.log(`📝 Processing message ${messageCount}: ${msg.id}`);
                    
                    // Check for video attachments
                    if (msg.attachments.size > 0) {
                        console.log(`📎 Found ${msg.attachments.size} attachments`);
                        
                        for (const attachment of msg.attachments.values()) {
                            const isVideo = attachment.contentType?.startsWith('video/') || 
                                           /\.(mp4|mov|avi|mkv|webm|wmv|flv)$/i.test(attachment.name || '');
                            
                            if (isVideo) {
                                console.log(`🎬 Found video: ${attachment.name}`);
                                
                                try {
                                    // RENAME VIDEO TO GRINDR
                                    const originalName = attachment.name || 'video.mp4';
                                    const extension = originalName.split('.').pop();
                                    const newName = `GRINDR_${videoCount + 1}.${extension}`;
                                    
                                    console.log(`🔄 Renaming: ${originalName} -> ${newName}`);
                                    
                                    // Download video
                                    console.log(`📥 Downloading: ${attachment.url}`);
                                    const response = await axios({
                                        url: attachment.url,
                                        responseType: 'arraybuffer',
                                        timeout: 30000
                                    });
                                    
                                    // Create new attachment with GRINDR name
                                    const videoBuffer = Buffer.from(response.data);
                                    const attachmentBuilder = new AttachmentBuilder(videoBuffer, { name: newName });
                                    
                                    // Send with GRINDR name
                                    await targetChannel.send({
                                        content: `**GRINDR** 🔞 ${videoCount + 1}`,
                                        files: [attachmentBuilder]
                                    });
                                    
                                    videoCount++;
                                    console.log(`✅ Uploaded: ${newName} (Total: ${videoCount})`);
                                    
                                    // Rate limit delay
                                    await delay(3000);
                                    
                                } catch (error) {
                                    console.error(`❌ Error processing video:`, error.message);
                                }
                            }
                        }
                    }
                    
                    // Check for video in embeds
                    if (msg.embeds.length > 0) {
                        for (const embed of msg.embeds) {
                            if (embed.video?.url) {
                                console.log(`🎥 Found video embed: ${embed.video.url}`);
                                
                                try {
                                    const response = await axios({
                                        url: embed.video.url,
                                        responseType: 'arraybuffer',
                                        timeout: 30000
                                    });
                                    
                                    const newName = `GRINDR_embed_${videoCount + 1}.mp4`;
                                    const videoBuffer = Buffer.from(response.data);
                                    const attachmentBuilder = new AttachmentBuilder(videoBuffer, { name: newName });
                                    
                                    await targetChannel.send({
                                        content: `**GRINDR** 🔞 Embed ${videoCount + 1}`,
                                        files: [attachmentBuilder]
                                    });
                                    
                                    videoCount++;
                                    console.log(`✅ Uploaded embed: ${newName}`);
                                    await delay(3000);
                                    
                                } catch (error) {
                                    console.error(`❌ Error processing embed:`, error.message);
                                }
                            }
                        }
                    }
                }
                
                lastId = messages.last().id;
                console.log(`🔄 Next batch starting from: ${lastId}`);
                
                // Longer delay between batches
                await delay(5000);
                
                if (messages.size < 50) {
                    console.log('✅ Reached end of channel');
                    break;
                }
            }
            
            if (isCopying) {
                console.log(`🎉 Copy completed! Videos: ${videoCount}`);
                await message.reply(`✅ Copy completed! ${videoCount} videos renamed to GRINDR!`);
            } else {
                await message.reply(`⏹️ Copy stopped. ${videoCount} videos renamed to GRINDR.`);
            }
            
        } catch (error) {
            console.error('❌ Fatal error:', error);
            await message.reply(`❌ Error: ${error.message}`);
        } finally {
            isCopying = false;
        }
    }
    
    // STOP COPY COMMAND
    if (command === 'stop' && args[0] === 'copy') {
        if (isCopying) {
            isCopying = false;
            await message.reply('⏹️ Stopping copy process...');
            console.log('🛑 Copy process stopped by user');
        } else {
            await message.reply('ℹ️ No copy process is running.');
        }
        return;
    }
    
    // CLONE COMMAND
    if (command === 'clone') {
        if (args.length < 2) {
            await message.reply('❌ Usage: `$clone <source_guild_id> <target_guild_id>`');
            return;
        }
        
        await message.reply('⚠️ Clone command is complex. Use `$copy` for single channel first.');
        return;
    }
    
    // HELP COMMAND
    if (command === 'cmds' || command === 'help') {
        const helpText = `
**GRINDR BOT COMMANDS** 🔞

\`$test\` - Test if bot is working
\`$copy <source> <target>\` - Copy videos (renamed to GRINDR)
\`$stop copy\` - Stop copying
\`$cmds\` - Show this help

*More commands coming soon...*
        `;
        await message.reply(helpText);
        return;
    }
    
    // UNKNOWN COMMAND
    console.log(`❓ Unknown command: ${command}`);
    await message.reply(`❓ Unknown command. Use \`$cmds\` for help.`);
});

client.once('ready', () => {
    console.log('\n✅✅✅ BOT IS READY ✅✅✅');
    console.log(`Logged in as: ${client.user.tag}`);
    console.log(`Bot ID: ${client.user.id}`);
    console.log(`Prefix: ${PREFIX}`);
    console.log('==============================\n');
    
    // Set bot status
    client.user.setActivity('GRINDR Uploader', { type: 'PLAYING' });
});

client.on('error', (error) => {
    console.error('❌ Client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
});

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// START BOT
console.log('🔑 Logging in with token...');
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('❌ Failed to login:', error.message);
    console.log('⚠️ Check your DISCORD_TOKEN environment variable');
    process.exit(1);
});
