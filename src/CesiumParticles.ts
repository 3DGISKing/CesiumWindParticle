import {
  Cartesian2,
  Cartesian3,
  EllipsoidalOccluder,
  Ellipsoid,
  Math as CesiumMath,
  Scene,
  SceneTransforms,
} from "cesium";
import { NetCDFReader } from "netcdfjs";
import Particle from "./Particle";
import Field from "./Field";

interface GFSRecord {
  header: {
    la1: number;
    la2: number;
    lo1: number;
    lo2: number;
    dx: number;
    dy: number;
    nx: number;
    ny: number;
    parameterCategory: number;
    parameterNumber: number;
  };
  data: [number];
}

interface ParticleOptions {
  globalAlpha: number;
  lineWidth: number;
  colorScale: string | string[];
  velocityScale: number;
  maxAge: number;
  paths: number;
  frameRate: number;
}

const scratchScreenPosition = new Cartesian2();

function indexFor(m: number, min: number, max: number, colorScale: string[]) {
  return Math.max(
    0,
    Math.min(
      colorScale.length - 1,
      Math.round(((m - min) / (max - min)) * (colorScale.length - 1))
    )
  );
}

class CesiumParticles {
  private _scene?: Scene;
  private _canvas?: HTMLCanvasElement;
  private _ctx?: CanvasRenderingContext2D;
  field?: Field;
  options: ParticleOptions;
  private _particles?: Particle[];
  starting = false;
  forceStop = false;
  _then: number = -1;
  animationLoop: number = -1;

  constructor(options: ParticleOptions) {
    this.options = options;

    window.addEventListener("resize", () => {
      this._onResize();
    });
  }

  get scene() {
    return this._scene!;
  }

  get canvas() {
    return this._canvas!;
  }

  get ctx() {
    return this._ctx!;
  }

  get particles() {
    return this._particles!;
  }

  _onResize() {
    this.adjustSize();
  }

  addToCesiumScene(scene: Scene) {
    if (!this.field) {
      throw new Error("field is required!");
    }

    this._scene = scene;

    const canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:absolute; left:0; top:0;user-select:none;pointer-events: none;";
    this._ctx = canvas.getContext("2d")!;

    this._canvas = canvas;

    this.adjustSize();

    const cesiumWidget = this._scene.canvas.parentNode;
    cesiumWidget!.appendChild(this.canvas);

    this._particles = this.prepareParticles();
    this.animate = this.animate.bind(this);

    this._then = Date.now();
    this.animate();
  }

  static async createFromGFSUrl(
    gfsUrl: string,
    particleOptions: ParticleOptions
  ) {
    const windParticle = new CesiumParticles(particleOptions);

    const res = await fetch(gfsUrl);
    const json = await res.json();

    windParticle.field = CesiumParticles.createFieldFromGFS(json);

    return windParticle;
  }

  static async createFromNetCDFUrl(
    netCDFUrl: string,
    particleOptions: ParticleOptions
  ) {
    const windParticle = new CesiumParticles(particleOptions);

    const res = await fetch(netCDFUrl);
    const buffer = await res.arrayBuffer();

    const NetCDF = new NetCDFReader(buffer);

    const arrayToMap = function (array: any) {
      return array.reduce((map: any, object: any) => {
        map[object.name] = object;
        return map;
      }, {});
    };

    const dimensions = arrayToMap(NetCDF.dimensions);

    const lonArray = new Float32Array(
      NetCDF.getDataVariable("longitude").flat()
    );
    const latArray = new Float32Array(
      NetCDF.getDataVariable("latitude").flat()
    );

    const xmin = Math.min(...lonArray);
    const xmax = Math.max(...lonArray);
    const ymin = Math.min(...latArray);
    const ymax = Math.max(...latArray);

    const u = new Float32Array(NetCDF.getDataVariable("u10").flat());
    const v = new Float32Array(NetCDF.getDataVariable("v10").flat());

    const cols = dimensions.longitude.size;
    const rows = dimensions.latitude.size;

    const deltaX = (xmax - xmin) / cols;
    const deltaY = (ymax - ymin) / rows;

    windParticle.field = new Field({
      xmin: xmin,
      ymin: ymin,
      xmax: xmax,
      ymax: ymax,
      deltaX: deltaX,
      deltaY: deltaY,
      cols: cols,
      rows: rows,
      us: u,
      vs: v,
    });

    return windParticle;
  }

  static createFieldFromGFS(data: GFSRecord[]) {
    let uComp: GFSRecord | undefined;
    let vComp: GFSRecord | undefined;

    console.time("format-data");

    data.forEach(function (record) {
      switch (
        record.header.parameterCategory +
        "," +
        record.header.parameterNumber
      ) {
        case "1,2":
        case "2,2":
          uComp = record;
          break;
        case "1,3":
        case "2,3":
          vComp = record;
          break;
      }
    });

    if (!vComp || !uComp) {
      throw new Error("invalid data");
    }

    const header = uComp.header;

    const vectorField = new Field({
      xmin: header.lo1,
      ymin: header.la1,
      xmax: header.lo2,
      ymax: header.la2,
      deltaX: header.dx,
      deltaY: header.dy,
      cols: header.nx,
      rows: header.ny,
      us: uComp.data,
      vs: vComp.data,
    });
    {
      console.timeEnd("format-data");
    }

    return vectorField;
  }

  adjustSize() {
    const canvas = this.canvas;

    const { width, height } = this.scene.canvas;
    const devicePixelRatio = 1;

    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;

    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
  }

  moveParticles() {
    const canvas = this.ctx.canvas;
    const width = canvas.width;
    const height = canvas.height;

    // 清空组
    const maxAge = this.options.maxAge;
    const velocityScale = this.options.velocityScale;

    const particles = this.particles;
    const field = this.field!;

    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];

      if (particle.age > maxAge) {
        particle.age = 0;

        // restart, on a random x,y
        field.assignRandomPosition(
          particle,
          width,
          height,
          this.unproject.bind(this)
        );
      }

      const x = particle.x;
      const y = particle.y;

      const vector = field.interpolatedValueAt(x, y);

      if (vector === null) {
        particle.age = maxAge;
      } else {
        const xt = x + vector.u * velocityScale;
        const yt = y + vector.v * velocityScale;

        if (field.hasValueAt(xt, yt)) {
          // Path from (x,y) to (xt,yt) is visible, so add this particle to the appropriate draw bucket.
          particle.xt = xt;
          particle.yt = yt;
          particle.m = vector.m;
        } else {
          // Particle isn't visible, but it still moves through the field.
          particle.x = xt;
          particle.y = yt;
          particle.age = maxAge;
        }
      }

      particle.age++;
    }
  }

  fadeIn() {
    const prev = this.ctx.globalCompositeOperation; // lighter

    this.ctx.globalCompositeOperation = "destination-in";
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.ctx.globalCompositeOperation = prev;
  }

  drawParticles() {
    this.fadeIn();

    this.ctx.globalAlpha = this.options.globalAlpha;
    this.ctx.fillStyle = "rgba(0, 0, 0, " + this.options.globalAlpha + ")";
    this.ctx.lineWidth = this.options.lineWidth;

    const range = this.field!.range;

    const min = range[0];
    const max = range[1];

    const particles = this.particles;

    for (let i = 0; i < particles.length; i++) {
      if (!particles[i].xt) {
        continue;
      }

      if (!particles[i].yt) {
        continue;
      }

      this.drawCoordsParticle(particles[i], min, max);
    }
  }

  /**
   * 用于绘制坐标粒子
   * @param particle
   * @param min
   * @param max
   */
  drawCoordsParticle(particle: Particle, min: number, max: number) {
    // TODO 需要判断粒子是否超出视野
    // this.ctx.strokeStyle = color;
    const source: [number, number] = [particle.x, particle.y];
    const target: [number, number] = [particle.xt!, particle.yt!];

    if (
      this.intersectsCoordinate(target) &&
      particle.age <= this.options.maxAge
    ) {
      const pointPrev = this.project(source);
      const pointNext = this.project(target);

      if (pointPrev && pointNext) {
        this.ctx.beginPath();

        this.ctx.moveTo(pointPrev[0], pointPrev[1]);
        this.ctx.lineTo(pointNext[0], pointNext[1]);

        particle.x = particle.xt!;
        particle.y = particle.yt!;

        if (Array.isArray(this.options.colorScale)) {
          const colorIdx = indexFor(
            particle.m!,
            min,
            max,
            this.options.colorScale
          );

          this.ctx.strokeStyle = this.options.colorScale[colorIdx];
        } else {
          this.ctx.strokeStyle = this.options.colorScale;
        }

        this.ctx.stroke();
      }
    }
  }

  prepareParticles() {
    const canvas = this.ctx.canvas;
    const width = canvas.width;
    const height = canvas.height;

    const particleCount = this.options.paths;

    const particles = [];

    for (let i = 0; i < particleCount; i++) {
      const particle = {
        age: this.getRandomAge(),
        x: 0,
        y: 0,
      };

      this.field!.assignRandomPosition(
        particle,
        width,
        height,
        this.unproject.bind(this)
      );

      particles.push(particle);
    }

    return particles;
  }

  getRandomAge() {
    return Math.floor(Math.random() * this.options.maxAge); // 例如最大生成90帧插值粒子路径
  }

  project(coordinate: [number, number]) {
    const scene = this.scene;
    // const height = scene.globe.getHeight(carto);
    const height = 0;

    const position = Cartesian3.fromDegrees(
      coordinate[0],
      coordinate[1],
      height
    );

    const windowPosition = SceneTransforms.worldToWindowCoordinates(
      scene,
      position
    );

    if (!windowPosition) {
      return null;
    }

    return [windowPosition.x, windowPosition.y];
  }

  unproject(pixel: [number, number]): [number, number] | null {
    scratchScreenPosition.x = pixel[0];
    scratchScreenPosition.y = pixel[1];

    const scene = this.scene;
    const ray = scene.camera.getPickRay(scratchScreenPosition);

    if (!ray) {
      return null;
    }

    const cartesian = scene.globe.pick(ray, scene);

    if (!cartesian) {
      return null;
    }

    const ellipsoid = scene.globe.ellipsoid;
    const cartographic = ellipsoid.cartesianToCartographic(cartesian);
    const lat = CesiumMath.toDegrees(cartographic.latitude);
    const lng = CesiumMath.toDegrees(cartographic.longitude);

    return [lng, lat];
  }

  intersectsCoordinate(coordinate: [number, number]) {
    const ellipsoid = Ellipsoid.WGS84;
    const camera = this.scene.camera;
    const occluder = new EllipsoidalOccluder(ellipsoid, camera.position);
    const point = Cartesian3.fromDegrees(coordinate[0], coordinate[1]);

    return occluder.isPointVisible(point);
  }

  animate() {
    if (this.animationLoop) {
      cancelAnimationFrame(this.animationLoop);
    }

    this.animationLoop = requestAnimationFrame(this.animate);

    const now = Date.now();

    const delta = now - this._then;

    if (delta > this.options.frameRate) {
      this._then = now - (delta % this.options.frameRate);
      this.render();
    }
  }

  /**
   * 开始渲染
   */
  render() {
    this.moveParticles();
    this.drawParticles();
  }
}

export default CesiumParticles;
