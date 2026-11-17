import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDownloadZip } from '@/composables/useDownloadZip';
import { fetchFiles } from '@/lib/client';
import { fetchArrayBufferWithTimeout } from '@/lib/httpClient';

type MockZip = {
  file: ReturnType<typeof vi.fn>;
  generateAsync: ReturnType<typeof vi.fn>;
};

let lastZipInstance: MockZip | null = null;
let resolvedZip: Blob = {} as Blob;

vi.mock('jszip', () => ({
  default: class {
    file = vi.fn();
    generateAsync = vi.fn().mockImplementation(async () => resolvedZip);

    constructor() {
      lastZipInstance = this as unknown as MockZip;
    }
  },
}));

vi.mock('@/lib/client', () => ({ fetchFiles: vi.fn() }));
vi.mock('@/lib/httpClient', () => ({ fetchArrayBufferWithTimeout: vi.fn() }));

const targets = [{ path: 'DCSWorld/a.txt' }, { path: 'UserMissions/b.txt' }];
const files = targets.map(({ path }, index) => ({ path, url: `https://example.com/snapshot/${index}` }));

describe('useDownloadZip', () => {
  const fetchFilesMock = vi.mocked(fetchFiles);
  const fetchBufferMock = vi.mocked(fetchArrayBufferWithTimeout);

  beforeEach(() => {
    vi.resetAllMocks();
    lastZipInstance = null;
    resolvedZip = {} as Blob;
    fetchFilesMock.mockResolvedValue(files);
    fetchBufferMock.mockResolvedValue(new ArrayBuffer(2));
  });

  it('対象パスを一括取得し返されたURLから既存パスのZIPを生成する', async () => {
    resolvedZip = { tag: 'zip' } as unknown as Blob;
    const { createZipFromTargets } = useDownloadZip({ maxConcurrentDownloads: 2 });

    const result = await createZipFromTargets(targets);

    expect(result).toBe(resolvedZip);
    expect(fetchFilesMock).toHaveBeenCalledExactlyOnceWith(targets.map(({ path }) => path));
    expect(fetchBufferMock).toHaveBeenNthCalledWith(1, files[0]?.url);
    expect(fetchBufferMock).toHaveBeenNthCalledWith(2, files[1]?.url);
    expect(lastZipInstance?.file).toHaveBeenNthCalledWith(1, targets[0]?.path, expect.any(ArrayBuffer));
    expect(lastZipInstance?.file).toHaveBeenNthCalledWith(2, targets[1]?.path, expect.any(ArrayBuffer));
    expect(lastZipInstance?.generateAsync).toHaveBeenCalledWith({ type: 'blob' });
  });

  it('ファイル情報の取得失敗時は本体取得とZIP生成を行わない', async () => {
    fetchFilesMock.mockRejectedValue(new Error('metadata failed'));
    await expect(useDownloadZip().createZipFromTargets(targets)).rejects.toThrow('metadata failed');
    expect(fetchBufferMock).not.toHaveBeenCalled();
    expect(lastZipInstance).toBeNull();
  });

  it('一部の本体取得に失敗した場合はZIPを生成しない', async () => {
    fetchBufferMock.mockResolvedValueOnce(new ArrayBuffer(2)).mockRejectedValueOnce(new Error('file failed'));
    await expect(useDownloadZip().createZipFromTargets(targets)).rejects.toThrow('file failed');
    expect(lastZipInstance?.file).toHaveBeenCalledTimes(1);
    expect(lastZipInstance?.generateAsync).not.toHaveBeenCalled();
  });

  it('本体取得の同時実行数を制限する', async () => {
    let active = 0;
    let peak = 0;
    fetchBufferMock.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active--;
      return new ArrayBuffer(2);
    });
    await useDownloadZip({ maxConcurrentDownloads: 1 }).createZipFromTargets(targets);
    expect(peak).toBe(1);
    expect(fetchBufferMock).toHaveBeenCalledTimes(2);
  });
});
