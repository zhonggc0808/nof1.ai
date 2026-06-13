/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 数据库迁移脚本：添加策略归因字段
 *
 * trades 表新增：
 *   - strategy: 策略名称（如 "alpha-beta"）
 *   - strategy_version: 策略版本号（如 "v4.0"）
 *   - prompt_version: Prompt 版本号
 *   - decision_id: 关联的 agent_decisions.id
 *   - params_snapshot: 策略参数快照（JSON）
 *
 * agent_decisions 表新增：
 *   - strategy: 策略名称
 *   - prompt_version: Prompt 版本号
 *   - params_snapshot: 策略参数快照（JSON）
 *   - market_regime: 市场环境分类（trend/range/volatile）
 *   - intended_action: AI 意图（open_long/open_short/close/hold）
 *
 * 兼容已有数据库：使用 PRAGMA table_info 检查字段是否已存在
 */

import { createClient } from "@libsql/client";
import { createLogger } from "../utils/loggerUtils";
import "dotenv/config";

const logger = createLogger({
  name: "db-migration-strategy-fields",
  level: "info",
});

interface ColumnDef {
  table: string;
  column: string;
  type: string;
  defaultValue?: string;
}

const NEW_COLUMNS: ColumnDef[] = [
  // trades 表
  { table: "trades", column: "strategy", type: "TEXT" },
  { table: "trades", column: "strategy_version", type: "TEXT" },
  { table: "trades", column: "prompt_version", type: "TEXT" },
  { table: "trades", column: "decision_id", type: "INTEGER" },
  { table: "trades", column: "params_snapshot", type: "TEXT" },
  { table: "trades", column: "decision_trace_id", type: "TEXT" },
  // agent_decisions 表
  { table: "agent_decisions", column: "strategy", type: "TEXT" },
  { table: "agent_decisions", column: "prompt_version", type: "TEXT" },
  { table: "agent_decisions", column: "params_snapshot", type: "TEXT" },
  { table: "agent_decisions", column: "market_regime", type: "TEXT" },
  { table: "agent_decisions", column: "intended_action", type: "TEXT" },
  { table: "agent_decisions", column: "decision_trace_id", type: "TEXT" },
  { table: "agent_decisions", column: "target_symbol", type: "TEXT" },
  { table: "agent_decisions", column: "confidence", type: "INTEGER" },
];

async function migrate() {
  const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
  logger.info(`📦 连接数据库: ${dbUrl}`);

  const client = createClient({ url: dbUrl });

  try {
    // 获取各表已存在的字段
    const tableColumns = new Map<string, Set<string>>();
    for (const table of ["trades", "agent_decisions"]) {
      const info = await client.execute({
        sql: `PRAGMA table_info(${table})`,
        args: [],
      });
      const columns = new Set<string>();
      for (const row of info.rows) {
        columns.add((row as any).name);
      }
      tableColumns.set(table, columns);
      logger.info(`表 ${table} 现有字段: ${[...columns].join(", ")}`);
    }

    // 按表分组添加新字段
    for (const { table, column, type } of NEW_COLUMNS) {
      const existing = tableColumns.get(table);
      if (!existing) {
        logger.warn(`表 ${table} 不存在，跳过`);
        continue;
      }

      if (existing.has(column)) {
        logger.info(`✅ ${table}.${column} 已存在，跳过`);
        continue;
      }

      logger.info(`➕ 添加 ${table}.${column} (${type})...`);
      await client.execute({
        sql: `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`,
        args: [],
      });
      logger.info(`✅ ${table}.${column} 添加成功`);
    }

    // 验证
    logger.info("\n======== 验证迁移结果 ========");
    for (const table of ["trades", "agent_decisions"]) {
      const info = await client.execute({
        sql: `PRAGMA table_info(${table})`,
        args: [],
      });
      logger.info(`\n${table} 表结构:`);
      for (const row of info.rows) {
        const r = row as any;
        logger.info(`  - ${r.name}: ${r.type}${r.dflt_value ? ` DEFAULT ${r.dflt_value}` : ""}`);
      }
    }

    logger.info("\n✅ 策略归因字段迁移完成！");
  } catch (error: any) {
    logger.error(`❌ 迁移失败: ${error.message}`);
    throw error;
  } finally {
    client.close();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
