# Ranked Bedwars System by deyo

A comprehensive Discord integration system for Minecraft Bedwars servers that provides ranked gameplay, queue management, and real-time communication between Discord and Minecraft.

## Features

### Discord Bot Features
- Advanced queue management with ELO-based matchmaking
- Support for both random and captain-based picking modes
- Party system with size restrictions
- Game scoring and statistics tracking
- Screenshare functionality for fair play enforcement
- Voice channel management for teams
- Game result logging and voiding capabilities
- Administrative commands for game management
- Player verification system
- Command permissions system
- Worker bot support for high-traffic servers
- Real-time queue status updates

### Minecraft Plugin Features
- Bedwars1058 and MBedwars support (dual compatibility)
- WebSocket communication with Discord bot
- Player warping to specific game arenas
- Real-time game status updates
- Screenshare request handling
- Game scoring integration
- Player verification system
- Call command for voice access
- Game voiding and scoring notifications
- Map management and availability tracking

### Queue System
- ELO-based matchmaking with configurable ranges
- Support for ranked and unranked games
- Party queue management with size limits
- Priority queue system for fair processing
- Queue status broadcasting
- Automatic player movement between channels

### Security & Authentication
- WebSocket authentication using AUTH_KEY
- Player verification system
- Screenshare functionality for anti-cheat
- Permission-based command access
- Player restriction system (bans, mutes, freezes)

## Installation

### Discord Bot Setup

1. **Prerequisites**
   - Node.js 16+ installed
   - MongoDB database connection
   - Discord bot token with required permissions

2. **Installation**
   ```bash
   cd RBW-latest
   npm install
   ```

3. **Configuration**
   - Copy `.env.example` to `.env`
   - Fill in your Discord bot token and other required values
   - Set up MongoDB connection string
   - Configure channel and role IDs
   - Set the AUTH_KEY for WebSocket & API authentication

4. **Build and Run**
   ```bash
   npm run build
   npm start
   ```

5. **Adding queues and Ranks**
   - Using /addelo to add ranks and /addqueue to add queues

6. **Starting the season**
   - Using /startseason

### Minecraft Plugin Setup

1. **Prerequisites**
   - Java 11+ installed
   - Minecraft server (Spigot/Paper 1.8.8+)
   - Bedwars1058 or MBedwars plugin installed

2. **Compilation**
   ```bash
   cd RBW-LATEST-Ingame
   mvn clean package
   ```
   
   The compiled JAR file will be in the `target/` directory.

3. **Configuration**
   - Place the JAR file in your server's `plugins/` folder
   - Restart the server to generate the config file
   - Edit `config.yml`
   - Edit `permission.yml` with discord role ids

4. **Server Requirements**
   - Java 11 or higher (configured in pom.xml)
   - Bedwars1058 (version 25.6+) or MBedwars (version 5.3.2+)
   - WebSocket connectivity to Discord bot server

## Usage

### For Players
- Join queue voice channels based on your ELO range
- Use in-game commands for verification and game management
- Participate in ranked and unranked games
- Request screenshares when needed
- Join parties for group play

### For Administrators
- Use administrative commands to manage games and players
- Configure queue settings and ELO ranges
- Manage player restrictions and permissions
- Monitor game statistics and logs

## Architecture

The system consists of two main components:

1. **Discord Bot** - Handles Discord interactions, queue management, matchmaking, and communication
2. **Minecraft Plugin** - Handles in-game events, player warping, and game integration

These components communicate through a secure WebSocket connection authenticated with the AUTH_KEY.

## Supported Bedwars Plugins

- **BedWars1058** - Version 25.6+ (by Andrei1058)
- **MBedwars** - Version 5.3.2+ (by Marcely)

The system automatically detects which plugin is installed and uses the appropriate API integration.

## WebSocket Communication

The Discord bot and Minecraft plugin communicate via a secure WebSocket connection:
- Authentication required using AUTH_KEY
- Real-time game status updates
- Player verification and online checks
- Game scoring and voiding notifications
- Screenshare requests and management

## Development
Check the specific project README files:
- [Discord Bot README](RBW-latest/README.md)
- [Minecraft Plugin README](RBW-LATEST-Ingame/README.md)

To run in development mode:
```bash
# Discord Bot
npm run dev

# For Minecraft plugin
mvn clean package
```

## Support

For issues and support, contact [confessingtoday](https://discord.gg/ygueB6rZRX) on Discord.