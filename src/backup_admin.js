const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { getKeys } = require('./tokenGeneration');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');
const app = express();
const axios = require('axios');
const admin = '7070127929';
const { games, commands, keysFiles, sleep, TrackedPromise, sleepDuration, batchSize, tryCatchBlock } = require('./utils');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

app.listen(3000, () => {
    console.log('\x1b[32m%s\x1b[0m', `Server running on port 3000`);
})

async function sendKeys(msg, filePath) {
    let keys = JSON.parse(fs.readFileSync(filePath));
    let userFound = false;
    let userKeys = [];
    for (let [key, value] of Object.entries(keys)) {
        if (key === msg.chat.id.toString()) {
            userFound = true;
            userKeys = value;
        }
    }
    if (userFound) {
        if (userKeys.length > 0) {
            let keysToSend = userKeys.slice(0, 4);
            keysToSend = keysToSend.map(key => `\`${key}\``);
            await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, keysToSend.join('\n\n'), {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '🗑️',
                                callback_data: 'delete'
                            }
                        ]
                    ]
                }
            }));
            keys[msg.chat.id] = userKeys.slice(4);
            fs.writeFileSync(filePath, JSON.stringify(keys, null, 2));
        }
        else {
            await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'You have no keys left. Use /generatekeys to generate keys'), msg.chat.id);
        }
    }
    else {
        await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'You have no keys left. Use /generatekeys to generate keys'), msg.chat.id);
    }
}

const informAdmin = (msg, msgToSend) => {
    if ((msg.chat.id).toString() !== admin) {
        bot.sendMessage(admin, msgToSend);
    }
}

bot.onText(new RegExp('.'), (msg) => {
    informAdmin(msg, `${msg.chat.first_name} sent a message: ${msg.text}`);
});

bot.onText('/start', async (msg) => {
    await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'Welcome to the Hamster Key Generator Bot!'), msg.chat.id);
    const userInfo = {
        id: msg.chat.id,
        username: msg.chat.username,
        first_name: msg.chat.first_name,
        last_name: msg.chat.last_name
    };
    const filePath = path.join(__dirname, '..', 'assets', 'Keys', 'Bot_Users.json');
    if (!fs.existsSync(filePath)) { fs.writeFileSync(filePath, '[]') }
    const existingUsers = JSON.parse(fs.readFileSync(filePath));
    if (!existingUsers.some(user => user.id === userInfo.id)) {
        existingUsers.push(userInfo);
        fs.writeFileSync(filePath, JSON.stringify(existingUsers, null, 2));
    }
    informAdmin(msg, `${msg.chat.first_name} started the bot`);
});

bot.onText('/remaining', async (msg) => {
    const keys = [];
    let userFound = false;
    keysFiles.forEach(file => {
        const filePath = path.join(__dirname, '..', 'assets', 'Keys', file);
        if (!fs.existsSync(filePath)) { fs.writeFileSync(filePath, '{}') }
        const data = JSON.parse(fs.readFileSync(filePath));
        for (const [key, value] of Object.entries(data)) {
            if (key === msg.chat.id.toString()) {
                keys.push(`${file.replace('_keys.json', '')}: ${value.length}`);
                userFound = true;
            }
        }
    });
    if (userFound) {
        await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, keys.join('\n')), msg.chat.id);
    }
    else {
        keysFiles.forEach(file => {
            keys.push(`${file.replace('_keys.json', '')}: 0`);
        });
        await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, keys.join('\n')), msg.chat.id);
    }
    informAdmin(msg, `${msg.chat.first_name} requested remaining keys`);
});

bot.onText('/users', async (msg) => {
    if (msg.chat.id.toString() === admin) {
        const filePath = path.join(__dirname, '..', 'assets', 'Keys', 'Bot_Users.json');
        if (!fs.existsSync(filePath)) { fs.writeFileSync(filePath, '[]') }
        const users = JSON.parse(fs.readFileSync(filePath));

        if (users.length === 0) {
            await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'No users found'), msg.chat.id);
            return;
        }
        const list = users.map(user =>
            `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}${user.username ? `: @${user.username}` : ''}`
        );
        await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, list.join('\n')), msg.chat.id);
    }
    else {
        await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'Only admin can use this command'), msg.chat.id);
        informAdmin(msg, `${msg.chat.first_name} tried to access users list`);
    }
});

async function generateAllKeys(msg) {
    const tasks = [];
    const keyTypes = Object.keys(games);
    for (const keyType of keyTypes) {
        tasks.push(() => new TrackedPromise(getKeys(keyType, 4, msg.chat.id), keyType));
    }
    informAdmin(msg, `${msg.chat.first_name} requested to generate all keys`);
    try {
        let activeTasks = [], index = 0, messageIds = [];
        while (index < tasks.length) {
            if (activeTasks.length < batchSize) {
                activeTasks.push(tasks[index]());
                let message = await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, `Generating ${keyTypes[index]} keys...`), msg.chat.id);
                messageIds.push({
                    keyType: keyTypes[index],
                    messageId: message.message_id
                });
                if (activeTasks.length != batchSize) { await sleep(sleepDuration / 2); }
                index++;
            }
            else {
                await Promise.race(activeTasks.map(task => task.promise));
                activeTasks = activeTasks.filter(async (task) => {
                    if (task.isPending()) { return true; }
                    else {
                        await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, `${task.getGame()} keys have been generated!`), msg.chat.id);
                        let toDeleteMsg = messageIds.find(message => message.keyType === task.getGame());
                        bot.deleteMessage(msg.chat.id, toDeleteMsg.messageId);
                        messageIds = messageIds.filter(message => message.keyType !== task.getGame());
                        return false;
                    }
                });
            }
        }
        activeTasks.map(task => task.promise.then(async () => {
            await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, `${task.getGame()} keys have been generated!`), msg.chat.id);
            let toDeleteMsg = messageIds.find(message => message.keyType === task.getGame());
            bot.deleteMessage(msg.chat.id, toDeleteMsg.messageId);
            messageIds = messageIds.filter(message => message.keyType !== task.getGame());
        }));
        informAdmin(msg, `${msg.chat.first_name} successfully generated all keys`);
    } catch (error) {
        console.error(error);
        await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'Error generating keys: ' + error), msg.chat.id);
    }
}

function showInlineKeyboard(type) {
    const game = Object.keys(games);
    if (type === 'generate') { game.push('All') }
    const buttonsPerRow = 3;
    let rows = [];
    for (let i = 0; i < game.length; i += buttonsPerRow) {
        const row = game.slice(i, i + buttonsPerRow).map(g => ({
            text: g,
            callback_data: type === 'get' ? g : `generate${g}`
        }));
        rows.push(row);
    }
    return rows;
}

bot.onText('/getkeys', async (msg) => {
    let rows = showInlineKeyboard('get');
    await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'Select a game to get keys', {
        reply_markup: {
            inline_keyboard: rows
        }
    }), msg.chat.id);
});

bot.onText('/generatekeys', async (msg) => {
    let rows = showInlineKeyboard('generate');
    await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'Select a game to generate keys', {
        reply_markup: {
            inline_keyboard: rows
        }
    }), msg.chat.id);
});

bot.on('callback_query', async (callbackQuery) => {
    bot.answerCallbackQuery(callbackQuery.id);
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    if (data.startsWith('generate')) {
        const game = data.replace('generate', '');
        if (game === 'All') { generateAllKeys(msg) } else {
            let msgtodel = await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, `Generating ${game} keys...`), msg.chat.id);
            await getKeys(game, 4, msg.chat.id);
            bot.deleteMessage(msg.chat.id, msgtodel.message_id);
            await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, `${game} keys have been generated!`), msg.chat.id);
        };
    }
    else if (data === 'delete') {
        bot.deleteMessage(msg.chat.id, msg.message_id);
    }
    else {
        sendKeys(msg, path.join(__dirname, '..', 'assets', 'Keys', `${data}_keys.json`));
    }
});