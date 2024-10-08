"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require('dotenv').config();
const express_1 = __importDefault(require("express"));
const sqlite3_1 = __importDefault(require("sqlite3"));
const app = (0, express_1.default)();
const port = process.env.PORT || 3000; // Porta onde o servidor irá escutar
// Conectar ao banco de dados
const db = new sqlite3_1.default.Database('memory.db');
// Criar tabela de usuários
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    password TEXT,
    api_key TEXT,
    data DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
// Criar memória de curto prazo
db.run(`
  CREATE TABLE IF NOT EXISTS shortmemory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    role TEXT,
    memory TEXT,
    data DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
// Função para obter o usuário da chave api informada
function getUserByApiKey(apiKey) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE api_key = ?', [apiKey], (err, row) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(row);
            }
        });
    });
}
// Middleware para autenticação
app.use((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const apiKey = req.headers.authorization;
    if (!apiKey) {
        return res.status(401).json({ error: 'API key não fornecida' });
    }
    try {
        const user = yield getUserByApiKey(apiKey);
        if (!user) {
            return res.status(401).json({ error: 'API key inválida' });
        }
        req.user = user;
        next();
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao verificar a API key' });
    }
}));
// Função para adicionar memória de curto prazo
function addToShortMemory(userId, role, memory) {
    db.run('INSERT INTO shortmemory (user_id, role, memory) VALUES (?, ?, ?)', [userId, role, memory], (err) => {
        if (err) {
            console.error(err.message);
        }
    });
    // Apaga memórias anteriores a 33 minutos
    db.run('DELETE FROM shortmemory WHERE data < datetime("now", "-33 minutes")');
}
// Função para ler histório de um usuário
function lastMemories(userId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT user_id, role, memory FROM shortmemory WHERE user_id = ? ORDER BY data ASC', [userId], (err, rows) => {
            if (err) {
                reject(err);
            }
            else {
                // Informar nome na primeira linha do histórico depois preencher com o histórico
                resolve(rows.map(row => ({ role: row.role, parts: [{ text: row.memory }] })));
            }
        });
    });
}
// Importa a biblioteca do Gemini
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, } = require("@google/generative-ai");
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: "Você é uma assistente e amiga. Seu nome é Gemini. O nome do seu patrão e amigo é Hermann. Você se comporta como uma mulher. Se te perguntarem algo referente há algo que foi conversado antes mas não está no histórico, diga que não se lembra, peça para te lembrar."
});
const generationConfig = {
    temperature: 1.4,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 8192,
    responseMimeType: "text/plain",
};
// Default route
app.get('/', (req, res) => {
    res.send('API Gemini funcionando!');
});
// Rota para receber a pergunta
app.get('/ask', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ask = req.query.ask;
    const userId = req.query.userId; // Assumindo que o ID do usuário seja passado como parâmetro
    try {
        // Adiciona a memoria de curto prazo
        addToShortMemory(userId, "user", ask);
        // Cria uma nova sessão de chat
        const chatSession = model.startChat({
            generationConfig,
            // safetySettings: Adjust safety settings
            // See https://ai.google.dev/gemini-api/docs/safety-settings
            history: yield lastMemories(userId),
            // safetySettings: {
            //   harmBlockThreshold: HarmBlockThreshold.HIGH,
            //   harmCategory: HarmCategory.ALL,
            // },
        });
        // Envia solicitação
        const result = yield chatSession.sendMessage(ask);
        const answer = result.response.text();
        // Adiciona a resposta ao histórico
        addToShortMemory(userId, "model", answer);
        // Retorna a resposta do Gemini
        res.json({ result: [answer] });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao processar a pergunta' });
    }
}));
app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
// Feche a conexão com o banco de dados quando o servidor parar
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Conexão com o banco de dados fechada.');
        process.exit(0);
    });
});
