/**
 * 画像生成の枚数の上限（サーバー側で管理する）
 * 1 日の合計と、1 回の実行ごとの上限を持つ。記録は PC 上のファイル（git 管理外）に残す。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export interface BudgetLimits {
  perDay: number; // Infinity で上限なし
  perRun: number;
}

// 画像を 1 枚作る前に呼ぶ。上限に達していたら BudgetError（生成の側は、これだけを知っていればよい。
// PC のスタジオはファイルに、サーバーの関数は Firestore に、枚数を記録する）
export interface ImageBudget {
  spend(): Promise<void>;
}

export class BudgetError extends Error {
  readonly status = 429;
}

interface Ledger {
  date: string;
  images: number;
}

export class Budget {
  readonly limits: BudgetLimits;
  private readonly file: string;
  private readonly today: () => string;
  private queue: Promise<unknown> = Promise.resolve(); // 同時に来た spend を 1 つずつ処理する
  constructor(file: string, limits: BudgetLimits, today: () => string = () => new Date().toISOString().slice(0, 10)) {
    this.file = file;
    this.limits = limits;
    this.today = today;
  }

  private async load(): Promise<Ledger> {
    try {
      const ledger = JSON.parse(await fs.readFile(this.file, 'utf8')) as Ledger;
      if (ledger.date === this.today() && Number.isFinite(ledger.images)) return ledger;
    } catch {
      // 記録が無い・読めない場合は 0 から
    }
    return { date: this.today(), images: 0 };
  }

  async usedToday(): Promise<number> {
    return (await this.load()).images;
  }

  // 実行を始める前の確認。最大 maxImages 枚を使う実行が、上限に収まるか
  async check(maxImages: number): Promise<void> {
    if (maxImages > this.limits.perRun) {
      throw new BudgetError(`1 回の実行で作れるのは最大 ${this.limits.perRun} 枚です（今回の見積もり: 最大 ${maxImages} 枚）。品目を減らしてください`);
    }
    const used = await this.usedToday();
    if (used + maxImages > this.limits.perDay) {
      throw new BudgetError(`今日の上限 ${this.limits.perDay} 枚を超えます（今日すでに ${used} 枚、今回の見積もり: 最大 ${maxImages} 枚）`);
    }
  }

  // 画像を 1 枚作る直前に呼ぶ。上限に達していたら Error（数は増えない）
  spend(): Promise<void> {
    const run = this.queue.then(async () => {
      const ledger = await this.load();
      if (ledger.images >= this.limits.perDay) throw new BudgetError(`今日の上限 ${this.limits.perDay} 枚に達しました`);
      ledger.images++;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(ledger) + '\n');
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
