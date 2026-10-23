# Vera_Multi - Quick Setup Guide

## Available Build Tools on E:

**Qt 6 / MinGW Location:**
- `E:\QT\Tools\mingw1310_64\` - MinGW 13.1.0 compiler
- Contains: `bin\`, `include\`, `lib\`, `qmake.exe`, etc.

**Other Tools:**
- `E:\QT\Tools\QtCreator\` - IDE
- `E:\QT\Tools\Ninja\` - Ninja build system

## What You Need to Decide:

### Option 1: Build Qt C++ Desktop App (recommended for learning)
- Uses SQLite database + Qt 6
- Creates a standalone `.exe` 
- Compiles with MinGW from `E:\QT\Tools\mingw1310_64`

### Option 2: Run Node.js/Express Server
- From cloned `C:\Users\Ярослав\Desktop\Проеты\vera-multi`
- Requires `npm install` first
- Provides web API backend

### Option 3: Both (Qt client + Node server)
- C++ desktop with local SQLite
- Node.js web backend with JSON

## Ready-to-Build Project State:

**C++ Project** at `C:\Users\Ярослав\Desktop\Проеты\Vera_Multi\app_desktop\`:
- ✅ CMakeLists.txt configured for Qt 6
- ✅ main.cpp with SQLite + Qt6 code  
- ✅ build.bat script (needs your MinGW path confirmation)
- ⚠️ CMake compiler test may fail (known issue, can work around)

**Node.js Project** at `C:\Users\Ярослав\Desktop\Проеты\vera-multi`:
- ✅ Git cloned from GitHub
- ❌ Missing `npm install` (dependencies)
- ❌ `express` module not found

## My Recommendation:

**Start with Option 1** (Qt C++ app) - it's more educational and gives you a working `.exe`. The build script is already prepared; I just need you to confirm the MinGW qmake path, or I can try configuring without it.

**Which option do you choose?**
1. Build the Qt C++ desktop app now
2. Set up the Node.js Express server  
3. Both projects
4. Something else