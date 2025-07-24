# NimmoBot - WhatsApp AI Assistant with Express.js & MongoDB

A powerful Express.js server built with TypeScript, MongoDB, and OpenAI for WhatsApp automation, intelligent conversations, and real-time event broadcasting.

## Features

- 🚀 Express.js server with TypeScript
- 🗄️ MongoDB integration with Mongoose
- 🔒 Security middleware (Helmet, CORS)
- 📝 Request logging with Morgan
- 🏗️ Clean architecture with MVC pattern
- 💰 FCFA currency support by default
- 🔄 Hot reloading in development
- 🤖 OpenAI GPT-3.5-turbo integration for intelligent, context-aware responses
- 📱 WhatsApp Web.js integration for 1:1 AI-powered messaging
- 🖼️ Sends offers with images and product links
- 🌐 Real-time WebSocket events for QR, status, and more

## Prerequisites

- Node.js (v16 or higher)
- MongoDB (local or cloud instance)
- npm or yarn

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd NimmoBotFinal
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   # Copy the example environment file
   cp env.example .env
   # Edit .env with your configuration
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/nimmobot
   NODE_ENV=development
   OPENAI_API_KEY=your-openai-api-key-here
   ```

4. **Start MongoDB**
   - Local: Make sure MongoDB is running on your machine
   - Cloud: Use MongoDB Atlas or any cloud MongoDB service

## Usage

### Development
```bash
npm run dev
```
This starts the server with nodemon for hot reloading. Scan the QR code on first run.

### Production
```bash
npm run build && npm start
```

### Other Commands
```bash
npm run watch   # Watch for TypeScript changes
npm run build   # Build TypeScript to JavaScript
```

## WhatsApp Automation

- **QR Code Authentication:**
  - On first run, a QR code is generated in the terminal and broadcast via WebSocket for easy scanning.
- **Session Persistence:**
  - Once authenticated, the session is saved and reused. Use helper functions to clear or check session status if needed.
- **Real-Time Events:**
  - Status updates (QR, ready, loading, disconnect, auth failure) are sent to WebSocket clients for frontend integration.
- **Message Handling:**
  - Only 1:1 user messages are processed (groups and status updates are ignored).
  - Each message triggers AI-powered intent extraction and a personalized response.

## AI-Powered Conversations

- **Intent Extraction:**
  - The bot uses OpenAI to extract user intent (service, town, budget, type, language) and stores it in MongoDB.
- **Offer Presentation:**
  - When all info is available, the bot searches the database and sends up to 5 matching offers, each with an image and product link.
  - If the user refuses or wants alternatives, new options are proposed.
  - If the user shows interest in a specific offer, a persuasive follow-up is sent.
- **Conversational Flow:**
  - If info is missing, the bot asks for it in a friendly, context-aware way (French or English).
  - All AI replies are generated using OpenAI's GPT-3.5-turbo.

## WebSocket Support

- Real-time updates (QR, ready, loading, auth failure, disconnect) are broadcast to connected WebSocket clients.
- Integrate with your frontend to display QR codes and status in real time.

## API Endpoints

### Health Check
- `GET /health` - Server health status

### Main API
- `GET /api` - Welcome message
- `GET /api/example` - Example endpoint with FCFA currency

### Users API
- `GET /api/users` - Get all users
- `POST /api/users` - Create a new user
- `GET /api/users/:id` - Get a specific user
- `PUT /api/users/:id` - Update a user
- `DELETE /api/users/:id` - Delete a user

### AI Service API
- `GET /api/ai/status` - Get AI service status and active conversations
- `GET /api/ai/conversation/:userId` - Get conversation history for a user
- `DELETE /api/ai/conversation/:userId` - Clear conversation history for a user

## Project Structure

```
src/
├── app.ts
├── controllers/
│   └── userController.ts
├── models/
│   ├── User.ts
│   ├── UserIntent.ts
│   ├── Immobilier.ts
│   └── Vehicule.ts
├── routes/
│   ├── ai.ts
│   ├── users.ts
│   ├── whatsapp.ts
│   └── index.ts
├── services/
│   ├── openaiService.ts
│   ├── websocketService.ts
│   └── whatsappService.ts
├── utils/
│   ├── database.ts
│   ├── fillDB.ts
│   └── searchDB.ts
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/nimmobot` |
| `NODE_ENV` | Environment mode | `development` |
| `OPENAI_API_KEY` | OpenAI API key for AI responses | Required |

## Currency

This project uses **FCFA** (Franc CFA) as the default currency throughout the application.

## Development

The project uses:
- **TypeScript** for type safety
- **Express.js** for the web framework
- **Mongoose** for MongoDB ODM
- **Nodemon** for development hot reloading
- **Helmet** for security headers
- **CORS** for cross-origin requests
- **Morgan** for HTTP request logging

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License 