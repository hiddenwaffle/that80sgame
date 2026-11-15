import { Container, Graphics, Sprite, Texture } from 'pixi.js';

/** The dusk sky and warm rays, built at layout time. Only the rays' transform changes each frame. */
export class TitleBackdrop {
  readonly view = new Container();
  private readonly rays = new Graphics();
  private readonly sky = new Sprite();
  private texture: Texture | null = null;

  constructor() {
    this.view.addChild(this.sky, this.rays);
  }

  place(width: number, height: number, cx: number, cy: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d')!;
    const dusk = g.createLinearGradient(width * 0.2, 0, width * 0.6, height);
    dusk.addColorStop(0, '#211345');
    dusk.addColorStop(0.47, '#5e215e');
    dusk.addColorStop(0.78, '#a7366a');
    dusk.addColorStop(1, '#e88055');
    g.fillStyle = dusk;
    g.fillRect(0, 0, width, height);
    const shade = g.createLinearGradient(0, height * 0.78, 0, height);
    shade.addColorStop(0, '#21134500');
    shade.addColorStop(1, '#211345b8');
    g.fillStyle = shade;
    g.fillRect(0, 0, width, height);
    const previous = this.texture;
    this.sky.texture = this.texture = Texture.from(canvas);
    previous?.destroy(true);
    const radius = Math.hypot(width, height) * 1.4;
    this.rays.clear();
    for (let i = 0; i < 14; i++) {
      const a = i * Math.PI * 2 / 14, b = a + Math.PI / 14;
      this.rays.poly([0, 0, Math.cos(a) * radius, Math.sin(a) * radius, Math.cos(b) * radius, Math.sin(b) * radius])
        .fill({ color: i % 2 ? 0xffa45b : 0xffd23f, alpha: i % 2 ? 0.13 : 0.09 });
    }
    this.rays.position.set(cx, cy);
  }

  update(dt: number, still: boolean): void {
    if (!still) this.rays.rotation -= dt * 0.014;
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.texture?.destroy(true);
    this.texture = null;
  }
}
