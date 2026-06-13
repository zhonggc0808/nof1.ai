# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

open-nof1.ai is an AI-driven cryptocurrency automated trading system built on [VoltAgent](https://voltagent.dev). It gives AI models (DeepSeek V3.2, Grok4, Claude, Gemini) full autonomy to analyze market data and make trading decisions. Both Gate.io and OKX exchanges are supported, settled in USDT perpetual futures.

**Tech stack:** TypeScript, Node.js 20+, VoltAgent (Agent framework), Hono (web server), LibSQL/SQLite (local persistence), node-cron (scheduler), ccxt (multi-exchange), Biome (linting), tsdown (build).

## Common Commands

```bash
# Development (hot-reload, reads .env)
npm run dev

# Production start
npm run trading:start

# Linting
npm run lint              # check only
npm run lint:fix          # auto-fix

# Type checking
npm run typecheck

# Build
npm run build

# Database
npm run db:init           # initialize database
npm run db:reset          # reset database
npm run db:status         # check database status
npm run db:sync           # sync trades from exchange
npm run db:sync-positions # sync positions from exchange

# Analysis / debugging scripts
npm run analyze:trades    # analyze trades by symbol
npm run test:websocket    # test OKX WebSocket connection
```

There are no unit tests. Run `npm run typecheck && npm run lint` to validate changes.

## Architecture

### Startup flow (`src/index.ts`)
1. `initDatabase()` — creates LibSQL tables
2. `initTradingSystem()` — reads env vars, syncs risk config to DB, initializes news MCP client
3. Hono web server starts on `PORT` (default 3141), serves `public/` as static files + REST API
4. `startTradingLoop()` — immediate first execution + cron schedule
5. Three background monitors start: trailing stop, stop loss, partial profit (each runs every 10s)
6. `startAccountRecorder()` — periodic account value snapshots

### Trading loop (`src/scheduler/tradingLoop.ts`)
The core 4000+ line file. Each cycle:
1. **Collect market data**: For each symbol in `RISK_PARAMS.TRADING_SYMBOLS`, fetch ticker price + K-lines across 6 timeframes (1m/3m/5m/15m/30m/1h), calculate EMA/MACD/RSI/ATR
2. **Collect news data** (parallel): Fetch crypto news, exchange announcements, events via Gate MCP News; failures are isolated
3. **Get account info**: Balance, unrealized PnL, Sharpe ratio
4. **Sync positions**: Read from exchange API, merge with DB metadata (peak PnL, partial close %, stop loss overrides)
5. **Force risk checks** (before AI decision): Max holding time exceeded → force close; extreme stop loss hit → force close; ultra-short strategy has additional cycle-based profit-locking rules
6. **Generate AI prompt**: Strategy-specific prompt with all market data, positions, trade history, recent decisions → call VoltAgent `agent.generateText()`
7. **AI executes tools**: `openPosition`, `closePosition`, `calculateRisk`, plus news query tools
8. **Post-decision**: Re-sync positions, fix historical PnL records, log final state

### Strategy system (`src/strategies/`)
11 trading strategies, each a pair of functions (`getXxxStrategy(maxLeverage)` → `StrategyParams`, `generateXxxPrompt(params, context)` → prompt string):
- **alpha-beta** (default): Zero strategy guidance, AI fully autonomous. Has a `maxIdleHours` enforcement (warns at 75%, forces at 100%).
- **ai-autonomous**: Minimal prompt, self-review/self-improvement loop required each cycle. Dual protection (code-level auto + AI active).
- **conservative/balanced/aggressive/aggressive-team**: Traditional risk-tier strategies with specific leverage ranges, stop loss/take profit rules, volatility adjustment
- **ultra-short/swing-trend/medium-long**: Timeframe-oriented strategies (5min/20min/30min cycle)
- **rebate-farming**: High-frequency micro-profit strategy (2-3min cycle)
- **multi-agent-consensus**: Jury-panel decision mode

Key strategy params: `leverageMin/Max`, `positionSizeMin/Max`, `stopLoss` (low/mid/high by leverage tier), `trailingStop` (3 levels), `partialTakeProfit` (3 stages), `peakDrawdownProtection`, `volatilityAdjustment`, `enableCodeLevelProtection`, `allowAiOverrideProtection`, `maxIdleHours`.

`getStrategyParams()` in `strategies/index.ts` dispatches by `TradingStrategy` type. The default strategy is `alpha-beta`.

### Exchange abstraction (`src/services/`)
- `IExchangeClient` interface defines all exchange operations (ticker, candles, account, positions, orders, funding rate, etc.)
- `createExchangeClient()` — singleton factory, switches between `GateClient` and `OkxClient` based on `EXCHANGE` env var
- `GateClient` wraps the `gate-api` SDK with retry logic, testnet/mainnet switching, position filtering by allowed symbols
- `OkxClient` wraps ccxt for OKX REST API
- `okxWebSocket.ts` — WebSocket connection for OKX real-time data

### Trading tools (`src/tools/trading/`)
Tools exposed to the AI agent via VoltAgent:
- **marketData**: `getMarketPrice`, `getTechnicalIndicators`, `getFundingRate`, `getOrderBook`, `getOpenInterest`
- **tradeExecution**: `openPosition`, `closePosition`, `cancelOrder`
- **accountManagement**: `getAccountBalance`, `getPositions`, `getOpenOrders`, `checkOrderStatus`, `calculateRisk`, `syncPositions`
- **newsData**: `getCryptoNews`, `getExchangeAnnouncements`, `getLatestEvents`

### Risk protection layers
1. **System-level hard limits** (in `tradingLoop.ts`, before AI runs): max holding time force close, extreme stop loss force close (`EXTREME_STOP_LOSS_PERCENT`, default -30%)
2. **Code-level auto monitors** (`scheduler/trailingStopMonitor.ts`, `stopLossMonitor.ts`, `partialProfitMonitor.ts`): run every 10s, apply strategy-specific stop loss / trailing stop / partial take profit rules — only when `enableCodeLevelProtection: true` on the strategy
3. **AI-driven decisions**: AI calls `closePosition` based on strategy prompt guidance
4. **Account-level circuit breakers**: `ACCOUNT_STOP_LOSS_USDT` and `ACCOUNT_TAKE_PROFIT_USDT` — if total balance hits these, all positions are closed and the process exits

### Database (`src/database/schema.ts`)
6 tables: `trades`, `positions`, `account_history`, `trading_signals`, `agent_decisions`, `system_config`. All use LibSQL (SQLite-compatible). The `positions` table stores metadata (peak PnL %, partial close %, stop loss) that supplements live exchange data.

### Web dashboard (`public/`)
Single-page monitoring dashboard served at `/`. REST API (`src/api/routes.ts`):
- `GET /api/account` — balance, PnL, fees, rebate info
- `GET /api/positions` — live positions with stop loss/take profit
- `GET /api/history` — account value history for charts
- `GET /api/trades` — trade records with win rate summary
- `GET /api/logs` — AI decision logs
- `GET /api/stats` — aggregate trading statistics
- `GET /api/prices` — real-time prices for multiple symbols
- `GET /api/strategy` — current strategy config
- `POST /api/close-position` — manual close (password-protected via `CLOSE_POSITION_PASSWORD` env var)
- IP blacklist middleware on all routes

### Configuration (`src/config/riskParams.ts`)
`RISK_PARAMS` object reads from env vars: `MAX_POSITIONS`, `MAX_LEVERAGE`, `TRADING_SYMBOLS`, `MAX_HOLDING_HOURS`, `EXTREME_STOP_LOSS_PERCENT`, account drawdown thresholds.

### Key env vars
`AI_MODEL_NAME`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` (OpenRouter-compatible), `TRADING_STRATEGY`, `TRADING_INTERVAL_MINUTES`, `EXCHANGE` (gate/okx), exchange API keys, `DATABASE_URL`, risk parameters.

## Git conventions
All commit messages must use Chinese descriptions with English type keywords. Format: `<type>[optional scope]: <中文描述>`. Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `style`, `test`, `build`, `chore`, `ci`. Do not auto-commit — always manually verify changes first. (See `.cursor/rules/git-commit.mdc`)

## Code style
- Strict TypeScript (`tsc --noEmit` with `strict: true`)
- Use `any` sparingly (common in API response handling due to untyped SDKs)
- File header: AGPL-3.0 license comment block (Chinese)
- Logging via `createLogger` from `utils/loggerUtils.ts` (wraps pino)
- Timezone: Asia/Shanghai (UTC+8), use `getChinaTimeISO()` from `utils/timeUtils.ts`
- Contract naming: `SYMBOL_USDT` (e.g., `BTC_USDT`)
