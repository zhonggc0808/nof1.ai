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
 * 决策上下文模块
 *
 * 在每个交易周期中，tradingLoop 在调用 agent.generateText 之前设置当前周期的
 * decisionId 和 traceId，工具函数（openPosition / closePosition）通过此模块
 * 获取正确的决策 ID，确保 trades 表与 agent_decisions 表的关联准确。
 *
 * 生命周期：
 * 1. tradingLoop 调用 setCurrentDecisionContext() 设置当前周期的上下文
 * 2. agent.generateText() 执行过程中，工具调用 getCurrentDecisionContext() 获取上下文
 * 3. generateText 完成后，tradingLoop 调用 clearCurrentDecisionContext() 清理
 */

export interface DecisionContext {
  /** 当前周期的 agent_decisions.id（在 agent.generateText 之前已 INSERT pending 记录） */
  decisionId: number;
  /** 当前周期的追踪 UUID，同时写入 agent_decisions 和 trades */
  traceId: string;
  /** 当前策略名称 */
  strategy?: string;
  /** 策略参数快照（JSON） */
  paramsSnapshot?: string;
}

let currentContext: DecisionContext | null = null;

/**
 * 设置当前周期的决策上下文
 * 在 agent.generateText() 之前调用
 */
export function setCurrentDecisionContext(context: DecisionContext): void {
  currentContext = context;
}

/**
 * 获取当前周期的决策上下文
 * 工具函数调用此方法获取 decisionId / traceId
 */
export function getCurrentDecisionContext(): DecisionContext | null {
  return currentContext;
}

/**
 * 清理当前周期的决策上下文
 * 在 agent.generateText() 完成、UPDATE agent_decisions 之后调用
 */
export function clearCurrentDecisionContext(): void {
  currentContext = null;
}
