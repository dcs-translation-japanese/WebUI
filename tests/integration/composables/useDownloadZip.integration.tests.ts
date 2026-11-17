import JSZip from 'jszip';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';
import { useDownloadZip } from '@/composables/useDownloadZip';
import { mswServer } from '../support/mswServer';

it('APIが返したスナップショットURLの内容を元のパスでZIPに格納する', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test');
  const paths = ['UserMissions/空白 を含む/README.md', 'DCSWorld/a/dictionary'];
  const downloaded: string[] = [];
  mswServer.use(
    http.post('https://api.example.test/v2/files', async ({ request }) => {
      expect(await request.json()).toEqual({ paths });
      return HttpResponse.json({
        commitSha: 'a'.repeat(40),
        generatedAt: '2026-05-15T00:00:00.000Z',
        files: paths.map((path, index) => ({ path, url: `https://files.example.test/snapshot/${index}` })),
      });
    }),
    http.get('https://files.example.test/snapshot/:index', ({ request, params }) => {
      downloaded.push(request.url);
      return HttpResponse.text(`content-${params.index}`);
    }),
  );

  const blob = await useDownloadZip().createZipFromTargets(paths.map((path) => ({ path })));
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  expect(Object.keys(zip.files).filter((path) => !zip.files[path]?.dir)).toEqual(paths);
  for (const [index, path] of paths.entries()) {
    expect(await zip.file(path)?.async('string')).toBe(`content-${index}`);
  }
  expect(downloaded.sort()).toEqual(['https://files.example.test/snapshot/0', 'https://files.example.test/snapshot/1']);
});
