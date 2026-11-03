import type { VNode } from '../src/assets/renderer';

const originalWorkers = process.env.IMAGE_RENDER_WORKERS;
const originalQueueLimit = process.env.IMAGE_RENDER_QUEUE_LIMIT;
const originalTimeout = process.env.IMAGE_RENDER_TIMEOUT_MS;

let imageRenderQueue: typeof import('../src/assets/imageRenderQueue');

const root: VNode = {
  type: 'div',
  props: {
    style: {
      display: 'flex',
      width: 64,
      height: 64,
      backgroundColor: '#080b10',
      color: '#ffffff',
      fontFamily: 'PoppinsMedium',
      fontSize: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    children: 'Test',
  },
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(() => {
  jest.resetModules();
  process.env.IMAGE_RENDER_WORKERS = '0';
  process.env.IMAGE_RENDER_QUEUE_LIMIT = '1';
  process.env.IMAGE_RENDER_TIMEOUT_MS = '10000';
  imageRenderQueue = require('../src/assets/imageRenderQueue') as typeof import('../src/assets/imageRenderQueue');
});

afterAll(() => {
  jest.resetModules();
  restoreEnv('IMAGE_RENDER_WORKERS', originalWorkers);
  restoreEnv('IMAGE_RENDER_QUEUE_LIMIT', originalQueueLimit);
  restoreEnv('IMAGE_RENDER_TIMEOUT_MS', originalTimeout);
});

describe('image render queue', () => {
  it('rejects invalid and oversized dimensions', async () => {
    await expect(imageRenderQueue.renderImage(root, 0, 64)).rejects.toBeInstanceOf(
      imageRenderQueue.ImageRenderError,
    );
    await expect(imageRenderQueue.renderImage(root, 5000, 64)).rejects.toBeInstanceOf(
      imageRenderQueue.ImageRenderError,
    );
  });

  it('rejects excess queued work while completing accepted jobs', async () => {
    const first = imageRenderQueue.renderImage(root, 64, 64);
    const second = imageRenderQueue.renderImage(root, 64, 64);
    const third = imageRenderQueue.renderImage(root, 64, 64);

    await expect(third).rejects.toBeInstanceOf(imageRenderQueue.ImageRenderOverloadedError);

    const [a, b] = await Promise.all([first, second]);
    expect(a.length).toBeGreaterThan(100);
    expect(b.length).toBeGreaterThan(100);
    expect(a[0]).toBe(0x89);
    expect(b[0]).toBe(0x89);
  });

  it('runs high-priority work before queued normal work', async () => {
    const order: string[] = [];
    const first = imageRenderQueue.renderImage(root, 64, 64).then(() => {
      order.push('first');
    });
    const second = imageRenderQueue.renderImage(root, 64, 64).then(() => {
      order.push('second');
    });
    const high = imageRenderQueue
      .renderImage(root, 64, 64, { priority: 'high' })
      .then(() => {
        order.push('high');
      });

    await Promise.all([first, second, high]);
    expect(order).toEqual(['first', 'high', 'second']);
  });
});
