class Vector {
    u: number;
    v: number;
    m: number;

    constructor(u: number, v: number) {
        this.u = u;
        this.v = v;
        this.m = this.magnitude();
    }

    /**
     * the vector value
     * 向量值（流体强度）
     * @returns {Number}
     */
    magnitude() {
        // Math.pow(u, 2)
        // Math.pow(v, 2)
        return Math.sqrt(this.u * this.u + this.v * this.v);
    }
    /**
     * Angle in degrees (0 to 360º) --> Towards
     * 流体方向
     * N is 0º and E is 90º
     * @returns {Number}
     */
    directionTo() {
        var verticalAngle = Math.atan2(this.u, this.v);
        var inDegrees = verticalAngle * (180.0 / Math.PI);
        if (inDegrees < 0) {
            inDegrees += 360.0;
        }
        return inDegrees;
    }
    /**
     * Angle in degrees (0 to 360º) From x-->
     * N is 0º and E is 90º
     * @returns {Number}
     */
    directionFrom() {
        var a = this.directionTo();
        return (a + 180.0) % 360.0;
    }
}

export default Vector;
