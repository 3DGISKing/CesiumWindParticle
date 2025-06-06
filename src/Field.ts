import Vector from "./Vector";
import Particle from "./Particle";

interface ConstructorOptions {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
    cols: number;
    rows: number;
    us: number[];
    vs: number[];
    deltaX: number;
    deltaY: number;

    wrappedX?: boolean;
}

/**
 * Get floored division
 * @param a
 * @param n
 * @returns {Number} returns remainder of floored division,
 * i.e., floor(a / n). Useful for consistent modulo of negative numbers.
 * See http://en.wikipedia.org/wiki/Modulo_operation.
 */
function floorMod(a: number, n: number) {
    return a - n * Math.floor(a / n);
}

export function isValid(x: any) {
    return x !== null && x !== undefined;
}

class Field {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
    cols: number;
    rows: number;
    us: number[];
    vs: number[];
    deltaX: number;
    deltaY: number;
    grid: Vector | null[][];
    isContinuous: boolean;
    wrappedX: boolean;
    range: [number, number];

    constructor(options: ConstructorOptions) {
        this.xmin = options.xmin;
        this.xmax = options.xmax;
        this.ymin = options.ymin;
        this.ymax = options.ymax;
        this.cols = options.cols; // 列数
        this.rows = options.rows; // 行数
        this.us = options.us; //
        this.vs = options.vs;
        this.deltaX = options.deltaX; // x 方向增量
        this.deltaY = options.deltaY; // y方向增量

        if (this.deltaY < 0 && this.ymin < this.ymax) {
            console.warn("[wind-core]: The data is flipY");
        } else {
            this.ymin = Math.min(options.ymax, options.ymin);
            this.ymax = Math.max(options.ymax, options.ymin);
        }

        const cols = Math.ceil((this.xmax - this.xmin) / options.deltaX); // 列
        const rows = Math.ceil((this.ymax - this.ymin) / options.deltaY); // 行

        if (cols !== this.cols || rows !== this.rows) {
            console.warn("[wind-core]: The data grid not equal");
        }

        // Math.floor(ni * Δλ) >= 360;
        // lon lat 经度 纬度
        this.isContinuous = Math.floor(this.cols * options.deltaX) >= 360;
        this.wrappedX = options.wrappedX ? options.wrappedX : this.xmax > 180; // [0, 360] --> [-180, 180];
        this.grid = this.buildGrid();
        this.range = this.calculateRange();
    }

    // from https://github.com/sakitam-fdd/wind-layer/blob/95368f9433/src/windy/windy.js#L110
    buildGrid() {
        const grid = [];
        let p = 0;

        const rows = this.rows;
        const cols = this.cols;
        const us = this.us;
        const vs = this.vs;

        for (let j = 0; j < rows; j++) {
            const row = [];

            for (let i = 0; i < cols; i++, p++) {
                const u = us[p];
                const v = vs[p];

                const valid = isValid(u) && isValid(v);

                if (!valid) {
                    console.log(`invalid ${i}, ${j}`);
                }

                row[i] = valid ? new Vector(u, v) : null;
            }

            if (this.isContinuous) {
                row.push(row[0]);
            }

            grid[j] = row;
        }

        return grid;
    }

    release() {
        this.grid = [];
    }

    /**
     * grib data extent
     * 格点数据范围
     */
    extent() {
        return [this.xmin, this.ymin, this.xmax, this.ymax];
    }
    /**
     * Bilinear interpolation for Vector
     * 针对向量进行双线性插值
     * https://en.wikipedia.org/wiki/Bilinear_interpolation
     * @param   {Number} x
     * @param   {Number} y
     * @param   {Number[]} g00
     * @param   {Number[]} g10
     * @param   {Number[]} g01
     * @param   {Number[]} g11
     * @returns {Vector}
     */
    bilinearInterpolateVector(
        x: number,
        y: number,
        g00: Vector,
        g10: Vector,
        g01: Vector,
        g11: Vector
    ) {
        const rx = 1 - x;
        const ry = 1 - y;
        const a = rx * ry;
        const b = x * ry;
        const c = rx * y;
        const d = x * y;
        const u = g00.u * a + g10.u * b + g01.u * c + g11.u * d;
        const v = g00.v * a + g10.v * b + g01.v * c + g11.v * d;

        return new Vector(u, v);
    }

    /**
     * calculate vector value range
     */
    calculateRange(): [number, number] {
        if (!this.grid || !this.grid[0]) {
            throw new Error("grid required");
        }

        const rows = this.grid.length;
        const cols = this.grid[0].length;

        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;

        // @from: https://stackoverflow.com/questions/13544476/how-to-find-max-and-min-in-array-using-minimum-comparisons
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                const vec = this.grid[j][i];

                if (vec !== null) {
                    const val = vec.m || vec.magnitude();
                    // vectors.push();
                    if (min === undefined) {
                        min = val;
                    } else if (max === undefined) {
                        max = val;
                        // update min max
                        // 1. Pick 2 elements(a, b), compare them. (say a > b)
                        min = Math.min(min, max);
                        max = Math.max(min, max);
                    } else {
                        // 2. Update min by comparing (min, b)
                        // 3. Update max by comparing (max, a)
                        min = Math.min(val, min);
                        max = Math.max(val, max);
                    }
                }
            }
        }

        return [min, max];
    }
    /**
     * 检查 uv是否合法
     * @param x
     * @private
     */

    getWrappedLongitudes() {
        let xmin = this.xmin;
        let xmax = this.xmax;

        if (this.wrappedX) {
            if (this.isContinuous) {
                xmin = -180;
                xmax = 180;
            } else {
                // not sure about this (just one particular case, but others...?)
                xmax = this.xmax - 360;
                xmin = this.xmin - 360;
                /* eslint-disable no-console */
                // console.warn(`are these xmin: ${xmin} & xmax: ${xmax} OK?`);
                // TODO: Better throw an exception on no-controlled situations.
                /* eslint-enable no-console */
            }
        }

        return [xmin, xmax];
    }

    contains(lon: number, lat: number) {
        const _a = this.getWrappedLongitudes(),
            xmin = _a[0],
            xmax = _a[1];

        const longitudeIn = lon >= xmin && lon <= xmax;
        let latitudeIn;

        if (this.deltaY >= 0) {
            latitudeIn = lat >= this.ymin && lat <= this.ymax;
        } else {
            latitudeIn = lat >= this.ymax && lat <= this.ymin;
        }

        return longitudeIn && latitudeIn;
    }
    /**
     * 获取经纬度所在的位置索引
     * @param lon
     * @param lat
     */
    getDecimalIndexes(lon: number, lat: number) {
        const i = floorMod(lon - this.xmin, 360) / this.deltaX; // calculate longitude index in wrapped range [0, 360)
        const j = (this.ymax - lat) / this.deltaY; // calculate latitude index in direction +90 to -90
        return [i, j];
    }
    /**
     * Nearest value at lon-lat coordinates
     * 线性插值
     * @param lon
     * @param lat
     */
    valueAt(lon: number, lat: number) {
        if (!this.contains(lon, lat)) {
            return null;
        }

        const indexes = this.getDecimalIndexes(lon, lat);
        const ii = Math.floor(indexes[0]);
        const jj = Math.floor(indexes[1]);
        const ci = this.clampColumnIndex(ii);
        const cj = this.clampRowIndex(jj);

        return this.valueAtIndexes(ci, cj);
    }

    /**
     * Get interpolated grid value lon-lat coordinates
     * 双线性插值
     * @param lon
     * @param lat
     */
    interpolatedValueAt(lon: number, lat: number) {
        if (!this.contains(lon, lat)) {
            return null;
        }

        const _a = this.getDecimalIndexes(lon, lat),
            i = _a[0],
            j = _a[1];

        return this.interpolatePoint(i, j);
    }

    hasValueAt(lon: number, lat: number) {
        const value = this.valueAt(lon, lat);

        return value !== null;
    }

    /**
     * 基于向量的双线性插值
     * @param i
     * @param j
     */
    interpolatePoint(i: number, j: number) {
        //         1      2           After converting λ and φ to fractional grid indexes i and j, we find the
        //        fi  i   ci          four points 'G' that enclose point (i, j). These points are at the four
        //         | =1.4 |           corners specified by the floor and ceiling of i and j. For example, given
        //      ---G--|---G--- fj 8   i = 1.4 and j = 8.3, the four surrounding grid points are (1, 8), (2, 8),
        //    j ___|_ .   |           (1, 9) and (2, 9).
        //  =8.3   |      |
        //      ---G------G--- cj 9   Note that for wrapped grids, the first column is duplicated as the last
        //         |      |           column, so the index ci can be used without taking a modulo.
        const indexes = this.getFourSurroundingIndexes(i, j);
        const fi = indexes[0],
            ci = indexes[1],
            fj = indexes[2],
            cj = indexes[3];
        const values = this.getFourSurroundingValues(fi, ci, fj, cj);
        if (values) {
            const g00 = values[0],
                g10 = values[1],
                g01 = values[2],
                g11 = values[3];
            // @ts-ignore
            return this.bilinearInterpolateVector(i - fi, j - fj, g00, g10, g01, g11);
        }
        return null;
    }
    /**
     * Check the column index is inside the field,
     * adjusting to min or max when needed
     * @private
     * @param   {Number} ii - index
     * @returns {Number} i - inside the allowed indexes
     */
    clampColumnIndex(ii: number) {
        let i = ii;

        if (ii < 0) {
            i = 0;
        }
        const maxCol = this.cols - 1;
        if (ii > maxCol) {
            i = maxCol;
        }
        return i;
    }

    /**
     * Check the row index is inside the field,
     * adjusting to min or max when needed
     * @private
     * @param   {Number} jj index
     * @returns {Number} j - inside the allowed indexes
     */
    clampRowIndex(jj: number) {
        let j = jj;

        if (jj < 0) {
            j = 0;
        }

        const maxRow = this.rows - 1;

        if (jj > maxRow) {
            j = maxRow;
        }

        return j;
    }
    /**
     * from: https://github.com/IHCantabria/Leaflet.CanvasLayer.Field/blob/master/src/Field.js#L252
     * 计算索引位置周围的数据
     * @private
     * @param   {Number} i - decimal index
     * @param   {Number} j - decimal index
     * @returns {Array} [fi, ci, fj, cj]
     */
    getFourSurroundingIndexes(i: number, j: number) {
        const fi = Math.floor(i); // 左
        let ci = fi + 1; // 右
        // duplicate colum to simplify interpolation logic (wrapped value)
        if (this.isContinuous && ci >= this.cols) {
            ci = 0;
        }

        ci = this.clampColumnIndex(ci);
        const fj = this.clampRowIndex(Math.floor(j)); // 上 纬度方向索引（取整）
        const cj = this.clampRowIndex(fj + 1); // 下

        return [fi, ci, fj, cj];
    }

    /**
     * from https://github.com/IHCantabria/Leaflet.CanvasLayer.Field/blob/master/src/Field.js#L277
     * Get four surrounding values or null if not available,
     * from 4 integer indexes
     * @private
     * @param   {Number} fi
     * @param   {Number} ci
     * @param   {Number} fj
     * @param   {Number} cj
     * @returns {Array}
     */
    getFourSurroundingValues(fi: number, ci: number, fj: number, cj: number) {
        let row;

        if ((row = this.grid[fj])) {
            const g00 = row[fi]; // << left
            const g10 = row[ci]; // right >>
            if (isValid(g00) && isValid(g10) && (row = this.grid[cj])) {
                // lower row vv
                const g01 = row[fi]; // << left
                const g11 = row[ci]; // right >>
                if (isValid(g01) && isValid(g11)) {
                    return [g00, g10, g01, g11]; // 4 values found!
                }
            }
        }
        return null;
    }
    /**
     * Value for grid indexes
     * @param   {Number} i - column index (integer)
     * @param   {Number} j - row index (integer)
     * @returns {Vector|Number}
     */
    valueAtIndexes(i: number, j: number) {
        return this.grid[j][i]; // <-- j,i !!
    }
    /**
     * Lon-Lat for grid indexes
     * @param   {Number} i - column index (integer)
     * @param   {Number} j - row index (integer)
     * @returns {Number[]} [lon, lat]
     */
    lonLatAtIndexes(i: number, j: number) {
        const lon = this.longitudeAtX(i);
        const lat = this.latitudeAtY(j);
        return [lon, lat];
    }
    /**
     * Longitude for grid-index
     * @param   {Number} i - column index (integer)
     * @returns {Number} longitude at the center of the cell
     */
    longitudeAtX(i: number) {
        const halfXPixel = this.deltaX / 2.0;
        let lon = this.xmin + halfXPixel + i * this.deltaX;

        if (this.wrappedX) {
            lon = lon > 180 ? lon - 360 : lon;
        }

        return lon;
    }
    /**
     * Latitude for grid-index
     * @param   {Number} j - row index (integer)
     * @returns {Number} latitude at the center of the cell
     */
    latitudeAtY(j: number) {
        const halfYPixel = this.deltaY / 2.0;

        return this.ymax - halfYPixel - j * this.deltaY;
    }
    /**
     * 生成粒子位置
     * @param particle
     * @param width
     * @param height
     * @param unproject
     */
    assignRandomPosition(
        particle: Particle,
        width: number,
        height: number,
        unproject: (p: [number, number]) => [number, number] | null
    ) {
        const i = (Math.random() * (width || this.cols)) | 0;
        const j = (Math.random() * (height || this.rows)) | 0;

        const coords = unproject([i, j]);

        if (coords !== null) {
            particle.x = coords[0];
            particle.y = coords[1];
        } else {
            particle.x = this.longitudeAtX(i);
            particle.y = this.latitudeAtY(j);
        }
    }
}

export default Field;
