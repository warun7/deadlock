# Deadlock - Competitive Programming Battle Arena

Real-time 1v1 competitive programming platform where players race to solve algorithmic problems.

## 🎮 Features

- **Real-time Matchmaking** - Find opponents and compete live
- **Judge0 Integration** - Execute code in 10+ languages
- **Verified Problems** - 1600+ Codeforces problems with test cases
- **Live Updates** - See opponent progress in real-time
- **Rating System** - ELO-based ranking
- **Match History** - Track your wins, losses, and performance

## 🚀 Tech Stack

### Frontend
- **React** + TypeScript + Vite
- **TailwindCSS** for styling
- **Socket.IO** for real-time communication
- **Monaco Editor** for code editing
- **Supabase** for authentication & database

### Backend
- **Node.js** + TypeScript + Express
- **Socket.IO** for WebSocket server
- **Redis** for queue & match state
- **PostgreSQL** (Supabase) for persistence
- **Judge0** for code execution

## 📦 Setup

### Prerequisites
- Node.js 18+
- Redis server
- Supabase account
- Judge0 instance (or use public API)

### Frontend Setup

```bash
cd deadlock
npm install
cp .env.example .env.local
# Edit .env.local with your credentials
npm run dev
```

### Backend Setup

```bash
cd server
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev
```

### Database Setup

1. Run schema in Supabase SQL Editor:
```bash
# Main schema
cat supabase-schema.sql

# Problems schema
cat problems-schema-v2.sql
```

2. Import problems:
```bash
cd deadlock
pip install datasets huggingface_hub
python scripts/import-codeforces-hf.py
```

## 🎯 Environment Variables

### Frontend (.env.local)
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_SOCKET_URL=http://localhost:3001
```

### Backend (.env)
```env
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
REDIS_URL=redis://localhost:6379
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JUDGE0_URL=https://judge.deadlock.sbs
```

## 🏗️ Project Structure

```
deadlock/
├── deadlock/          # Frontend React app
│   ├── components/    # React components
│   ├── lib/          # API & utilities
│   ├── pages/        # Page components
│   └── scripts/      # Import scripts
├── server/           # Backend Node.js server
│   ├── src/
│   │   ├── services/ # Core services
│   │   ├── socket/   # WebSocket handlers
│   │   └── middleware/ # Auth & security
│   └── package.json
└── README.md
```

## 🎮 How to Play

1. **Sign Up** - Create an account
2. **Join Queue** - Click "Find Match"
3. **Get Matched** - Wait for an opponent
4. **Solve Problem** - Write code to solve the problem
5. **Submit** - First correct submission wins!

## 🔧 Development

### Frontend Dev Server
```bash
cd deadlock
npm run dev
```

### Backend Dev Server
```bash
cd server
npm run dev
```

### Type Checking
```bash
npm run type-check
```

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please open an issue or PR.

## 🐛 Known Issues

- Match timeout is 30 minutes (configurable)
- Interactive problems not supported
- Maximum 20 test cases per problem

## 🎯 Roadmap

- [ ] Tournament mode
- [ ] Practice mode (solo)
- [ ] Leaderboards
- [ ] Problem difficulty filtering
- [ ] Code replay/review
- [ ] Mobile app

## 📧 Contact

For issues or questions, open a GitHub issue.
