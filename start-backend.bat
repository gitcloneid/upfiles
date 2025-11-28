@echo off
cd /d "%~dp0backend"
echo Starting Lomba Server on http://localhost:3001
cargo run --release
pause
