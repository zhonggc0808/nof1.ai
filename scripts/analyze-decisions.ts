/**
 * open-nof1.ai — 决策分析脚本
 *
 * 只读分析 agent_decisions 和 trades 表，输出：
 *   1. 数据概览（总数、pending、error）
 *   2. intended_action 分布
 *   3. market_regime 分布
 *   4. target_symbol 分布
 *   5. confidence 统计
 *   6. 按 intended_action 分组的平均 confidence
 *   7. trades 归因链路质量
 *   8. 按 strategy 统计
 *   9. 最近 20 条决策简表
 *
 * 用法: npm run analyze:decisions
 */

import { createClient } from "@libsql/client";

async function main() {
  const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
  const client = createClient({ url: dbUrl });

  const sep = "=".repeat(70);

  // ── 探测列是否存在 ──────────────────────────────────────────
  const colInfo = new Map<string, Set<string>>();
  for (const table of ["agent_decisions", "trades"]) {
    const info = await client.execute({ sql: `PRAGMA table_info(${table})`, args: [] });
    colInfo.set(table, new Set(info.rows.map((r: any) => r.name)));
  }
  const adCols = colInfo.get("agent_decisions")!;
  const trCols = colInfo.get("trades")!;

  const hasAdStrategy = adCols.has("strategy");
  const hasAdMarketRegime = adCols.has("market_regime");
  const hasAdIntendedAction = adCols.has("intended_action");
  const hasAdTargetSymbol = adCols.has("target_symbol");
  const hasAdConfidence = adCols.has("confidence");
  const hasAdPromptVersion = adCols.has("prompt_version");
  const hasTrDecisionId = trCols.has("decision_id");
  const hasTrDecisionTraceId = trCols.has("decision_trace_id");
  const hasTrStrategy = trCols.has("strategy");

  function missing(col: string, table: string) {
    console.log(`⚠️ 缺少字段 ${table}.${col}，请先运行迁移: npx tsx src/database/migrate-add-strategy-fields.ts`);
  }

  // ═══════════════════════════════════════════════════════════
  console.log(`\n${sep}`);
  console.log(" 决策分析报告");
  console.log(`${sep}\n`);

  // ── 1. 数据概览 ─────────────────────────────────────────────
  console.log("1. 数据概览");
  console.log("-".repeat(40));

  const totalResult = await client.execute({ sql: "SELECT COUNT(*) AS cnt FROM agent_decisions", args: [] });
  const totalDecisions = Number(totalResult.rows[0]?.cnt ?? 0);

  let pendingCount = 0;
  let errorCount = 0;
  try {
    const pendingResult = await client.execute({
      sql: `SELECT
              COUNT(*) FILTER (WHERE decision = '' OR decision IS NULL) AS pending_cnt,
              COUNT(*) FILTER (WHERE decision LIKE 'AGENT_ERROR%' OR decision LIKE 'FATAL_ERROR%' OR intended_action = 'error') AS error_cnt
            FROM agent_decisions`,
      args: [],
    });
    pendingCount = Number(pendingResult.rows[0]?.pending_cnt ?? 0);
    errorCount = Number(pendingResult.rows[0]?.error_cnt ?? 0);
  } catch {
    // FILTER 子句可能在旧版 SQLite 不可用，降级处理
    try {
      const p = await client.execute({ sql: "SELECT COUNT(*) AS cnt FROM agent_decisions WHERE decision = '' OR decision IS NULL", args: [] });
      pendingCount = Number(p.rows[0]?.cnt ?? 0);
      const e = await client.execute({ sql: "SELECT COUNT(*) AS cnt FROM agent_decisions WHERE decision LIKE 'AGENT_ERROR%' OR decision LIKE 'FATAL_ERROR%'", args: [] });
      errorCount = Number(e.rows[0]?.cnt ?? 0);
    } catch {
      console.log("  (无法统计 pending/error 分类)");
    }
  }

  console.log(`  agent_decisions 总数 : ${totalDecisions}`);
  console.log(`  pending (未完成)     : ${pendingCount}`);
  console.log(`  error (异常)         : ${errorCount}`);
  console.log();

  // ── 2. intended_action 分布 ──────────────────────────────────
  console.log("2. intended_action 分布");
  console.log("-".repeat(40));

  if (hasAdIntendedAction) {
    const iaRows = await client.execute({
      sql: `SELECT intended_action, COUNT(*) AS cnt FROM agent_decisions GROUP BY intended_action ORDER BY cnt DESC`,
      args: [],
    });
    if (iaRows.rows.length === 0) {
      console.log("  (暂无数据)");
    }
    for (const row of iaRows.rows) {
      const r = row as any;
      const ia = r.intended_action || "(空)";
      const pct = totalDecisions > 0 ? ((r.cnt / totalDecisions) * 100).toFixed(1) : "0.0";
      console.log(`  ${ia.padEnd(20)} ${String(r.cnt).padStart(5)}  (${pct}%)`);
    }
  } else {
    missing("intended_action", "agent_decisions");
  }
  console.log();

  // ── 3. market_regime 分布 ────────────────────────────────────
  console.log("3. market_regime 分布");
  console.log("-".repeat(40));

  if (hasAdMarketRegime) {
    const mrRows = await client.execute({
      sql: `SELECT market_regime, COUNT(*) AS cnt FROM agent_decisions GROUP BY market_regime ORDER BY cnt DESC`,
      args: [],
    });
    if (mrRows.rows.length === 0) {
      console.log("  (暂无数据)");
    }
    for (const row of mrRows.rows) {
      const r = row as any;
      const mr = r.market_regime || "(空)";
      const pct = totalDecisions > 0 ? ((r.cnt / totalDecisions) * 100).toFixed(1) : "0.0";
      console.log(`  ${mr.padEnd(24)} ${String(r.cnt).padStart(5)}  (${pct}%)`);
    }
  } else {
    missing("market_regime", "agent_decisions");
  }
  console.log();

  // ── 4. target_symbol 分布 ────────────────────────────────────
  console.log("4. target_symbol 分布");
  console.log("-".repeat(40));

  if (hasAdTargetSymbol) {
    const tsRows = await client.execute({
      sql: `SELECT target_symbol, COUNT(*) AS cnt FROM agent_decisions GROUP BY target_symbol ORDER BY cnt DESC`,
      args: [],
    });
    if (tsRows.rows.length === 0) {
      console.log("  (暂无数据)");
    }
    for (const row of tsRows.rows) {
      const r = row as any;
      const ts = r.target_symbol || "(空)";
      const pct = totalDecisions > 0 ? ((r.cnt / totalDecisions) * 100).toFixed(1) : "0.0";
      console.log(`  ${ts.padEnd(12)} ${String(r.cnt).padStart(5)}  (${pct}%)`);
    }
  } else {
    missing("target_symbol", "agent_decisions");
  }
  console.log();

  // ── 5. confidence 统计 ───────────────────────────────────────
  console.log("5. confidence 统计");
  console.log("-".repeat(40));

  if (hasAdConfidence) {
    try {
      const confResult = await client.execute({
        sql: `SELECT
                COUNT(confidence) AS cnt,
                ROUND(AVG(confidence), 1) AS avg_val,
                MIN(confidence) AS min_val,
                MAX(confidence) AS max_val
              FROM agent_decisions WHERE confidence IS NOT NULL`,
        args: [],
      });
      const cr = confResult.rows[0] as any;
      console.log(`  有效记录数 : ${cr.cnt ?? 0}`);
      console.log(`  平均值     : ${cr.avg_val ?? "N/A"}`);
      console.log(`  中位数     : (需要应用层计算，见下方分布)`);

      // 分布
      const distResult = await client.execute({
        sql: `SELECT
                CASE
                  WHEN confidence IS NULL THEN 'null'
                  WHEN confidence <= 20 THEN '0-20'
                  WHEN confidence <= 40 THEN '21-40'
                  WHEN confidence <= 60 THEN '41-60'
                  WHEN confidence <= 80 THEN '61-80'
                  ELSE '81-100'
                END AS bucket,
                COUNT(*) AS cnt
              FROM agent_decisions
              GROUP BY bucket
              ORDER BY bucket`,
        args: [],
      });
      for (const row of distResult.rows) {
        const r = row as any;
        console.log(`  ${r.bucket.padEnd(12)} ${String(r.cnt).padStart(5)}`);
      }
      console.log(`  最小值     : ${cr.min_val ?? "N/A"}`);
      console.log(`  最大值     : ${cr.max_val ?? "N/A"}`);
    } catch (e: any) {
      console.log(`  confidence 查询失败: ${e.message}`);
    }
  } else {
    missing("confidence", "agent_decisions");
  }
  console.log();

  // ── 6. 按 intended_action 分组的平均 confidence ──────────────
  console.log("6. 按 intended_action 分组的平均 confidence");
  console.log("-".repeat(40));

  if (hasAdIntendedAction && hasAdConfidence) {
    const groupResult = await client.execute({
      sql: `SELECT intended_action,
              COUNT(*) AS cnt,
              ROUND(AVG(confidence), 1) AS avg_conf
            FROM agent_decisions
            WHERE confidence IS NOT NULL
            GROUP BY intended_action
            ORDER BY cnt DESC`,
      args: [],
    });
    if (groupResult.rows.length === 0) {
      console.log("  (暂无数据)");
    }
    for (const row of groupResult.rows) {
      const r = row as any;
      const ia = r.intended_action || "(空)";
      console.log(`  ${ia.padEnd(20)} 数量=${String(r.cnt).padStart(4)}  平均confidence=${r.avg_conf}`);
    }
  } else {
    console.log("  (需要 intended_action 和 confidence 字段)");
  }
  console.log();

  // ── 7. trades 归因链路质量 ───────────────────────────────────
  console.log("7. trades 归因链路质量");
  console.log("-".repeat(40));

  const totalTradesResult = await client.execute({ sql: "SELECT COUNT(*) AS cnt FROM trades", args: [] });
  const totalTrades = Number(totalTradesResult.rows[0]?.cnt ?? 0);
  console.log(`  trades 总数: ${totalTrades}`);

  if (totalTrades === 0) {
    console.log("  (暂无 trades 数据)");
  } else {
    if (hasTrDecisionId) {
      const diResult = await client.execute({
        sql: `SELECT COUNT(*) AS cnt FROM trades WHERE decision_id IS NOT NULL`,
        args: [],
      });
      const diPct = ((Number(diResult.rows[0]?.cnt ?? 0) / totalTrades) * 100).toFixed(1);
      console.log(`  decision_id 非空      : ${diResult.rows[0]?.cnt ?? 0} / ${totalTrades} (${diPct}%)`);
    } else {
      missing("decision_id", "trades");
    }

    if (hasTrDecisionTraceId) {
      const dtResult = await client.execute({
        sql: `SELECT COUNT(*) AS cnt FROM trades WHERE decision_trace_id IS NOT NULL`,
        args: [],
      });
      const dtPct = ((Number(dtResult.rows[0]?.cnt ?? 0) / totalTrades) * 100).toFixed(1);
      console.log(`  decision_trace_id 非空: ${dtResult.rows[0]?.cnt ?? 0} / ${totalTrades} (${dtPct}%)`);
    }

    if (hasTrDecisionId) {
      try {
        const joinResult = await client.execute({
          sql: `SELECT COUNT(*) AS cnt FROM trades t
                INNER JOIN agent_decisions d ON t.decision_id = d.id
                WHERE t.decision_id IS NOT NULL`,
          args: [],
        });
        const joinable = Number(joinResult.rows[0]?.cnt ?? 0);
        const withDiResult = await client.execute({
          sql: `SELECT COUNT(*) AS cnt FROM trades WHERE decision_id IS NOT NULL`,
          args: [],
        });
        const withDi = Number(withDiResult.rows[0]?.cnt ?? 0);
        const joinPct = withDi > 0 ? ((joinable / withDi) * 100).toFixed(1) : "N/A";
        console.log(`  decision_id 可 join    : ${joinable} / ${withDi} (${joinPct}%)`);
      } catch (e: any) {
        console.log(`  join 检查失败: ${e.message}`);
      }
    }
  }
  console.log();

  // ── 8. 按 strategy 统计 ──────────────────────────────────────
  console.log("8. 按 strategy 统计");
  console.log("-".repeat(40));

  if (hasAdStrategy) {
    const stRows = await client.execute({
      sql: `SELECT strategy, COUNT(*) AS cnt FROM agent_decisions GROUP BY strategy ORDER BY cnt DESC`,
      args: [],
    });
    for (const row of stRows.rows) {
      const r = row as any;
      const strat = r.strategy || "(空)";
      console.log(`\n  [${strat}]  决策数: ${r.cnt}`);

      // 开仓 / 平仓 统计
      if (hasAdIntendedAction) {
        const actionResult = await client.execute({
          sql: `SELECT
                  COUNT(*) FILTER (WHERE intended_action IN ('open_long', 'open_short')) AS open_cnt,
                  COUNT(*) FILTER (WHERE intended_action IN ('close', 'reduce')) AS close_cnt
                FROM agent_decisions WHERE strategy = ?`,
          args: [strat],
        });
        const ar = actionResult.rows[0] as any;
        console.log(`    开仓决策: ${ar?.open_cnt ?? "N/A"}  平仓决策: ${ar?.close_cnt ?? "N/A"}`);
      }

      // 关联 trades 统计 PnL
      if (hasTrDecisionId && hasTrStrategy) {
        try {
          const pnlResult = await client.execute({
            sql: `SELECT
                    COUNT(*) AS trade_cnt,
                    ROUND(COALESCE(SUM(pnl), 0), 2) AS net_pnl,
                    ROUND(AVG(CASE WHEN pnl > 0 THEN 1.0 ELSE 0.0 END) * 100, 1) AS win_rate
                  FROM trades
                  WHERE strategy = ? AND type = 'close' AND pnl IS NOT NULL`,
            args: [strat],
          });
          const pr = pnlResult.rows[0] as any;
          console.log(`    已平仓 trades: ${pr?.trade_cnt ?? 0}  净盈亏: ${pr?.net_pnl ?? 0} USDT  胜率: ${pr?.win_rate ?? "N/A"}%`);
        } catch {
          console.log("    (PnL 统计查询失败，可能缺少字段)");
        }
      }
    }
  } else {
    missing("strategy", "agent_decisions");
  }
  console.log();

  // ── 9. 最近 20 条决策简表 ────────────────────────────────────
  console.log("9. 最近 20 条决策简表");
  console.log("-".repeat(70));

  // 动态构建列：根据实际存在的列决定显示哪些
  const displayCols = ["time", "strategy"];
  if (hasAdMarketRegime) displayCols.push("regime");
  if (hasAdIntendedAction) displayCols.push("action");
  if (hasAdTargetSymbol) displayCols.push("symbol");
  if (hasAdConfidence) displayCols.push("conf");
  if (hasTrDecisionId) displayCols.push("has_trade");
  if (hasTrDecisionId) displayCols.push("pnl");

  const colWidths: Record<string, number> = {
    time: 20, strategy: 14, regime: 10, action: 14, symbol: 8, conf: 5, has_trade: 10, pnl: 10,
  };

  const header2 = displayCols.map(c => c.padEnd(colWidths[c])).join("");
  console.log(header2);
  console.log("-".repeat(header2.length));

  try {
    // 动态构建 SELECT 子句
    const selectParts = ["d.id", "d.timestamp"];
    if (hasAdStrategy) selectParts.push("d.strategy");
    if (hasAdMarketRegime) selectParts.push("d.market_regime AS regime");
    if (hasAdIntendedAction) selectParts.push("d.intended_action AS action");
    if (hasAdTargetSymbol) selectParts.push("d.target_symbol AS symbol");
    if (hasAdConfidence) selectParts.push("d.confidence AS conf");
    const sql = `SELECT ${selectParts.join(", ")} FROM agent_decisions d ORDER BY d.id DESC LIMIT 20`;

    const recResult = await client.execute({ sql, args: [] });

    for (const row of recResult.rows) {
      const r = row as any;

      const time = String(r.timestamp ?? "").slice(0, 19);
      const strat = hasAdStrategy ? String(r.strategy ?? "-").slice(0, 13) : "-";
      const regime = hasAdMarketRegime ? String(r.regime ?? "-").slice(0, 9) : undefined;
      const action = hasAdIntendedAction ? String(r.action ?? "-").slice(0, 13) : undefined;
      const symbol = hasAdTargetSymbol ? String(r.symbol ?? "-").slice(0, 7) : undefined;
      const conf = hasAdConfidence ? (r.conf !== null && r.conf !== undefined ? String(r.conf) : "-") : undefined;

      // 关联 trade
      let tradeCount = 0;
      let pnlStr = "-";
      if (hasTrDecisionId) {
        try {
          const tc = await client.execute({
            sql: `SELECT COUNT(*) AS cnt FROM trades WHERE decision_id = ?`,
            args: [r.id],
          });
          tradeCount = Number(tc.rows[0]?.cnt ?? 0);

          const tp = await client.execute({
            sql: `SELECT ROUND(COALESCE(SUM(pnl), 0), 2) AS total_pnl FROM trades WHERE decision_id = ? AND type = 'close'`,
            args: [r.id],
          });
          const tpVal = Number(tp.rows[0]?.total_pnl ?? 0);
          pnlStr = tpVal !== 0 ? String(tpVal) : "-";
        } catch { /* ignore */ }
      }
      const hasTrade = hasTrDecisionId ? (tradeCount > 0 ? `Y(${tradeCount})` : "-") : undefined;

      const values: string[] = [time, strat];
      if (regime !== undefined) values.push(regime);
      if (action !== undefined) values.push(action);
      if (symbol !== undefined) values.push(symbol);
      if (conf !== undefined) values.push(conf);
      if (hasTrade !== undefined) values.push(hasTrade);
      if (hasTrDecisionId) values.push(pnlStr);

      console.log(values.map((v, i) => String(v).padEnd(colWidths[displayCols[i]])).join(""));
    }
  } catch (e: any) {
    console.log(`  查询失败: ${e.message}`);
  }

  // ── 10. 行为一致性审计 ─────────────────────────────────────
  console.log("10. 决策-工具行为一致性审计");
  console.log("-".repeat(70));

  if (!hasAdIntendedAction) {
    console.log("  (需要 intended_action 字段，请先运行迁移)");
  } else {
    // 获取所有有 intended_action 的决策（动态构建 SELECT 以兼容缺少字段的旧表）
    const auditableSelects = ["d.id", "d.intended_action", "d.decision", "d.decision_trace_id", "d.timestamp"];
    if (hasAdTargetSymbol) auditableSelects.push("d.target_symbol");
    const auditableResult = await client.execute({
      sql: `SELECT ${auditableSelects.join(", ")}
            FROM agent_decisions d
            WHERE d.intended_action IS NOT NULL AND d.intended_action != '' AND d.intended_action != 'error'
            ORDER BY d.id`,
      args: [],
    });

    const auditable = auditableResult.rows as any[];
    if (auditable.length === 0) {
      console.log("  (暂无带 intended_action 的审计数据)");
    } else {
      let consistentCount = 0;
      let mismatchCount = 0;
      let skippedCount = 0;
      const mismatches: any[] = [];

      // 一次性加载所有 trades，按 decision_id 分组
      const allTrades = new Map<number, any[]>();
      if (hasTrDecisionId) {
        const tradesResult = await client.execute({
          sql: `SELECT id, decision_id, decision_trace_id, symbol, side, type, leverage, pnl
                FROM trades
                WHERE decision_id IN (${auditable.map(d => d.id).join(",")})
                ORDER BY id`,
          args: [],
        });
        for (const row of tradesResult.rows) {
          const t = row as any;
          const di = Number(t.decision_id);
          if (!allTrades.has(di)) allTrades.set(di, []);
          allTrades.get(di)!.push(t);
        }
      }

      // 按 decision_trace_id 查找 trades（兜底）
      const tradesByTrace = new Map<string, any[]>();
      if (hasTrDecisionTraceId) {
        const traceIds = auditable.map(d => d.decision_trace_id).filter(Boolean);
        if (traceIds.length > 0) {
          const traceResult = await client.execute({
            sql: `SELECT id, decision_id, decision_trace_id, symbol, side, type, leverage, pnl
                  FROM trades
                  WHERE decision_trace_id IN (${traceIds.map(t => `'${t}'`).join(",")})
                  ORDER BY id`,
            args: [],
          });
          for (const row of traceResult.rows) {
            const t = row as any;
            const tid = String(t.decision_trace_id ?? "");
            if (!tradesByTrace.has(tid)) tradesByTrace.set(tid, []);
            tradesByTrace.get(tid)!.push(t);
          }
        }
      }

      // 对每条决策进行一致性检查
      for (const d of auditable) {
        const ia = String(d.intended_action ?? "").trim();
        const isObserveOrHold = ia === "observe" || ia === "hold";
        const isOpen = ia === "open_long" || ia === "open_short";
        const isClose = ia === "close" || ia === "reduce";

        // 找到关联 trades
        let relatedTrades: any[] = [];
        if (hasTrDecisionId) {
          relatedTrades = allTrades.get(Number(d.id)) ?? [];
        }
        if (relatedTrades.length === 0 && hasTrDecisionTraceId && d.decision_trace_id) {
          relatedTrades = tradesByTrace.get(String(d.decision_trace_id)) ?? [];
        }

        const openTrades = relatedTrades.filter((t: any) => t.type === "open");
        const closeTrades = relatedTrades.filter((t: any) => t.type === "close");

        // 一致性判断
        if (isObserveOrHold) {
          // 不应产生 open trade
          if (openTrades.length > 0) {
            mismatchCount++;
            mismatches.push({
              decisionId: d.id,
              timestamp: d.timestamp,
              intendedAction: ia,
              targetSymbol: d.target_symbol,
              issue: "observe/hold 却产生了开仓",
              tradeTypes: openTrades.map((t: any) => `${t.type} ${t.symbol} ${t.side}`).join(", "),
              detail: "mismatch_open",
            });
          } else {
            consistentCount++;
          }
        } else if (isOpen) {
          const expectedSide = ia === "open_long" ? "long" : "short";
          const hasExpectedOpen = openTrades.some((t: any) => t.side === expectedSide);

          if (hasExpectedOpen) {
            // 也检查 target_symbol 是否匹配
            const targetMismatch = d.target_symbol && d.target_symbol !== "none"
              && !openTrades.some((t: any) => t.symbol === d.target_symbol);
            consistentCount++;
            if (targetMismatch) {
              // 只在 mismatch 列表里记录，不影响一致性计数（方向对但币种错是警告）
              mismatches.push({
                decisionId: d.id,
                timestamp: d.timestamp,
                intendedAction: ia,
                targetSymbol: d.target_symbol,
                issue: `target_symbol 为 ${d.target_symbol}，但实际开仓币种为 ${openTrades.map((t: any) => t.symbol).join(", ")}`,
                tradeTypes: openTrades.map((t: any) => `${t.type} ${t.symbol} ${t.side}`).join(", "),
                detail: "target_mismatch",
              });
            }
          } else if (openTrades.length > 0) {
            // 有开仓但方向不对（如 intended open_long 实际开了 short）
            mismatchCount++;
            mismatches.push({
              decisionId: d.id,
              timestamp: d.timestamp,
              intendedAction: ia,
              targetSymbol: d.target_symbol,
              issue: `预期 ${expectedSide} 但实际开仓为 ${openTrades.map((t: any) => `${t.symbol} ${t.side}`).join(", ")}`,
              tradeTypes: openTrades.map((t: any) => `${t.type} ${t.symbol} ${t.side}`).join(", "),
              detail: "side_mismatch",
            });
          } else {
            // 意图开仓但没有 trade —— 可能是风控拒绝或工具失败
            const decisionText = String(d.decision ?? "");
            const rejectionPatterns = [
              "拒绝开仓", "开仓失败", "风控", "流动性不足", "冷却期", "冷却",
              "超过限制", "超过最大持仓", "超过最大杠杆", "超过仓位限制",
              "拒绝交易", "account drawdown", "达到最大持仓",
              "refused", "rejected",
            ];
            const isRejected = rejectionPatterns.some(p =>
              decisionText.includes(p)
            );
            mismatches.push({
              decisionId: d.id,
              timestamp: d.timestamp,
              intendedAction: ia,
              targetSymbol: d.target_symbol,
              issue: isRejected ? "意图开仓但被风控/工具拒绝（无实际 trade）" : "意图开仓但无实际 trade（原因未知）",
              tradeTypes: "(无)",
              detail: isRejected ? "no_trade_due_to_rejection" : "no_trade_unknown",
            });
            skippedCount++;
          }
        } else if (isClose) {
          if (closeTrades.length > 0) {
            consistentCount++;
          } else {
            // close/reduce 但没有 close trade —— 可能是工具失败
            mismatches.push({
              decisionId: d.id,
              timestamp: d.timestamp,
              intendedAction: ia,
              targetSymbol: d.target_symbol,
              issue: "意图平仓但无实际 close trade",
              tradeTypes: relatedTrades.length > 0
                ? relatedTrades.map((t: any) => `${t.type} ${t.symbol} ${t.side}`).join(", ")
                : "(无)",
              detail: "no_close_trade",
            });
            skippedCount++;
          }
        } else {
          skippedCount++;
        }
      }

      // 输出统计
      const auditableTotal = auditable.length;
      const totalChecked = consistentCount + mismatchCount; // 不含 skipped
      const consistencyRate = totalChecked > 0
        ? ((consistentCount / totalChecked) * 100).toFixed(1)
        : "N/A";

      console.log(`  可审计决策总数      : ${auditableTotal}`);
      console.log(`  一致 (✅)           : ${consistentCount}`);
      console.log(`  不一致 (❌)         : ${mismatchCount}`);
      console.log(`  跳过 (非交易决策等)  : ${skippedCount}`);
      console.log(`  一致率              : ${consistencyRate}%`);

      // 按 detail 分组的 mismatch 统计
      const detailCounts = new Map<string, number>();
      for (const m of mismatches) {
        const d = m.detail as string;
        detailCounts.set(d, (detailCounts.get(d) ?? 0) + 1);
      }
      if (detailCounts.size > 0) {
        console.log("\n  不一致分类:");
        for (const [detail, cnt] of detailCounts) {
          const label: Record<string, string> = {
            mismatch_open: "observe/hold 但有开仓",
            side_mismatch: "多空方向不匹配",
            target_mismatch: "币种不匹配",
            no_trade_due_to_rejection: "开仓意图被风控拒绝",
            no_trade_unknown: "开仓意图无交易(原因未知)",
            no_close_trade: "平仓意图无实际平仓",
          };
          console.log(`    ${label[detail] ?? detail}: ${cnt} 条`);
        }
      }

      // 最近 20 条 mismatch 明细
      if (mismatches.length > 0) {
        console.log(`\n  最近 20 条不一致明细:`);
        const mCols = ["time", "dec_id", "intended", "target", "issue", "trade_types"];
        const mWidths = [20, 7, 14, 8, 50, 30];

        const mHeader = mCols.map((c, i) => c.padEnd(Math.min(mWidths[i], c === "issue" ? 60 : mWidths[i]))).join("");
        console.log(`  ${mHeader}`);
        console.log(`  ${"-".repeat(mHeader.length)}`);

        const recentMismatches = mismatches.slice(-20).reverse();
        for (const m of recentMismatches) {
          const time = String(m.timestamp ?? "").slice(0, 19);
          const did = String(m.decisionId);
          const ia = String(m.intendedAction).slice(0, 13);
          const target = String(m.targetSymbol ?? "-").slice(0, 7);
          const issue = String(m.issue).slice(0, 55);
          const trades = String(m.tradeTypes).slice(0, 35);

          const values = [time, did, ia, target, issue, trades];
          const line = values.map((v, i) => String(v).padEnd(mWidths[i])).join("");
          console.log(`  ${line}`);
        }
      }
    }
  }

  console.log(`\n${sep}`);
  console.log(" 分析完成");
  console.log(`${sep}\n`);

  client.close();
}

main().catch((e) => {
  console.error("分析脚本执行失败:", e);
  process.exit(1);
});
