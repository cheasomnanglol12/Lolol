const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { getKeys } = require('./tokenGeneration');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');
const app = express();
const axios = require('axios');
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
            await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'You have no keys left. Use /generatekeys to generate keys'))
        }
    }
    else {
        await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'You have no keys left. Use /generatekeys to generate keys'));
    }
}

bot.onText('/start', async (msg) => {
    await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'Welcome to Hamster Kombat Key Generator! 🐹⚔️ use /generatekeys to generate keys'), msg.chat.id);
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
        await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, keys.join('\n')));
    }
    else {
        keysFiles.forEach(file => {
            keys.push(`${file.replace('_keys.json', '')}: 0`);
        });
        await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, keys.join('\n')));
    }
});

async function generateAllKeys(msg) {
    const tasks = [];
    const keyTypes = Object.keys(games);
    for (const keyType of keyTypes) {
        tasks.push(() => new TrackedPromise(getKeys(keyType, 4, msg.chat.id), keyType));
    }
    try {
        let activeTasks = [], index = 0, messageIds = [];
        while (index < tasks.length) {
            if (activeTasks.length < batchSize) {
                activeTasks.push(tasks[index]());
                let message = await bot.sendMessage(msg.chat.id, `Generating ${keyTypes[index]} keys...`);
                messageIds.push({
                    keyType: keyTypes[index],
                    messageId: message.message_id
                });
                if (activeTasks.length != batchSize) { await sleep(sleepDuration / 2); }
                index++;
            }
            else {
                await Promise.race(activeTasks.map(task => task.promise));
                activeTasks = activeTasks.filter(task => {
                    if (task.isPending()) { return true; }
                    else {
                        bot.sendMessage(msg.chat.id, `${task.getGame()} keys have been generated!`);
                        let toDeleteMsg = messageIds.find(message => message.keyType === task.getGame());
                        bot.deleteMessage(msg.chat.id, toDeleteMsg.messageId);
                        messageIds = messageIds.filter(message => message.keyType !== task.getGame());
                        return false;
                    }
                });
            }
        }
        activeTasks.map(task => task.promise.then(() => {
            bot.sendMessage(msg.chat.id, `${task.getGame()} keys have been generated!`);
            let toDeleteMsg = messageIds.find(message => message.keyType === task.getGame());
            bot.deleteMessage(msg.chat.id, toDeleteMsg.messageId);
            messageIds = messageIds.filter(message => message.keyType !== task.getGame());
        }));
    } catch (error) {
        console.error(error);
        bot.sendMessage(msg.chat.id, 'Error generating keys: ' + error);
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

bot.onText('/getkeys', (msg) => {
    let rows = showInlineKeyboard('get');
    bot.sendMessage(msg.chat.id, 'Select a game to get keys 🔑', {
        reply_markup: {
            inline_keyboard: rows
        }
    });
});

bot.onText('/generatekeys', async (msg) => {
    let rows = showInlineKeyboard('generate');
    await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, 'Select a game to generate keys', {
        reply_markup: {
            inline_keyboard: rows
        }
    }));

});

bot.on('callback_query', async (callbackQuery) => {
    bot.answerCallbackQuery(callbackQuery.id);
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    if (data.startsWith('generate')) {
        const game = data.replace('generate', '');
        if (game === 'All') { generateAllKeys(msg) } else {
            let msgtodel = await bot.sendMessage(msg.chat.id, `Generating ${game} keys...`);
            await getKeys(game, 4, msg.chat.id);
            bot.deleteMessage(msg.chat.id, msgtodel.message_id);
            await tryCatchBlock(async () => await bot.sendMessage(msg.chat.id, `${game} keys have been generated!`));
        };
    }
    else if (data === 'delete') {
        bot.deleteMessage(msg.chat.id, msg.message_id);
    }
    else {
        sendKeys(msg, path.join(__dirname, '..', 'assets', 'Keys', `${data}_keys.json`));
    }
});
