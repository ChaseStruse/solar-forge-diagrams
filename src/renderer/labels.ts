import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial } from 'three';

interface Page {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: CanvasTexture;
  x: number;
  y: number;
  rowHeight: number;
}
const SIZE = 1024;
const HEIGHT = 44;
/** Pack text into shared GPU images; texture clones share Three.js Source storage. */
export class LabelAtlas {
  private readonly pages: Page[] = [];
  public create(text: string, zoom: number): Sprite {
    let page = this.pages[this.pages.length - 1] ?? this.page();
    const width = Math.min(
      480,
      Math.ceil(page.context.measureText(text).width) + 20,
    );
    if (page.x + width > SIZE) {
      page.x = 0;
      page.y += page.rowHeight;
      page.rowHeight = 0;
    }
    if (page.y + HEIGHT > SIZE) page = this.page();
    const { x, y, context } = page;
    context.strokeText(text, x + width / 2, y + HEIGHT / 2, width - 16);
    context.fillText(text, x + width / 2, y + HEIGHT / 2, width - 16);
    const texture = page.texture.clone();
    texture.offset.set(x / SIZE, 1 - (y + HEIGHT) / SIZE);
    texture.repeat.set(width / SIZE, HEIGHT / SIZE);
    const sprite = new Sprite(
      new SpriteMaterial({ map: texture, depthTest: false }),
    );
    sprite.userData.labelWidth = width;
    sprite.userData.labelHeight = HEIGHT;
    sprite.scale.set((width * 0.5) / zoom, (HEIGHT * 0.5) / zoom, 1);
    sprite.renderOrder = 10;
    page.x += width + 4;
    page.rowHeight = Math.max(page.rowHeight, HEIGHT + 4);
    return sprite;
  }
  private page(): Page {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Text canvas unavailable');
    context.font = '600 26px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#f5eee1';
    context.strokeStyle = '#182027';
    context.lineWidth = 4;
    context.lineJoin = 'round';
    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    const page = { canvas, context, texture, x: 0, y: 0, rowHeight: 0 };
    this.pages.push(page);
    return page;
  }
  public finish(): void {
    for (const page of this.pages) page.texture.needsUpdate = true;
  }
  public dispose(): void {
    for (const page of this.pages) {
      page.texture.dispose();
      page.canvas.width = 0;
      page.canvas.height = 0;
    }
    this.pages.length = 0;
  }
}
