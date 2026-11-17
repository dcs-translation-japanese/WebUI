import JSZip from 'jszip';
import { fetchFiles } from '@/lib/client';
import { fetchArrayBufferWithTimeout } from '@/lib/httpClient';

const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 6;

export type ConcurrencyLimitOptions = {
  maxConcurrentDownloads?: number;
};

export type Target = {
  path: string;
};

/**
 * @summary ZIP生成処理をまとめたユーティリティを返す。
 * @param options 同時実行数の上限を指定する。
 * @returns ZIP生成処理を返す。
 */
export const useDownloadZip = (options: ConcurrencyLimitOptions = {}) => {
  const createZipFromTargetsWithOptions = async (targets: Target[]): Promise<Blob> => {
    return await createZipFromTargets(targets, options);
  };

  return { createZipFromTargets: createZipFromTargetsWithOptions };
};

/**
 * @summary 同時実行数を制限して非同期処理を実行する。
 * @typeParam T 対象配列の要素型を指定する。
 * @param items 対象要素の配列を指定する。
 * @param concurrency 同時実行数を指定する。
 * @param worker 各要素を処理する非同期関数を指定する。
 * @returns すべての処理が完了したら解決する。
 * @throws worker が例外を送出した場合にそのまま伝播する。
 */
const runWithConcurrencyLimit = async <T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> => {
  const limit = Math.max(1, Math.trunc(concurrency));
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
};

/**
 * @summary ダウンロード対象を ZIP にまとめる。
 * @param targets ダウンロード対象のリポジトリパス一覧を指定する。
 * @param options 同時実行数の上限を指定する。
 * @returns ZIP の Blob を返す。
 * @throws URL/パスが不正な場合に例外を送出する。
 * @throws ファイル取得や ZIP 生成に失敗した場合に例外を送出する。
 */
const createZipFromTargets = async (targets: Target[], options: ConcurrencyLimitOptions = {}): Promise<Blob> => {
  const maxConcurrentDownloads = options.maxConcurrentDownloads ?? DEFAULT_MAX_CONCURRENT_DOWNLOADS;
  const files = await fetchFiles(targets.map(({ path }) => path));
  const zip = new JSZip();
  await runWithConcurrencyLimit(files, maxConcurrentDownloads, async ({ path, url }): Promise<void> => {
    const buffer = await fetchArrayBufferWithTimeout(url);
    zip.file(path, buffer);
  });
  return zip.generateAsync({ type: 'blob' });
};
