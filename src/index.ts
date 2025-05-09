import { Viewer } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import CesiumParticles from "./CesiumParticles";

const viewer = new Viewer("cesiumContainer", {});

fetch("./wind.json")
    .then((res) => res.json())
    .then((res) => {
        new CesiumParticles({
            gfs: res,
            scene: viewer.scene,
            particleOptions: {
                globalAlpha: 0.9,
                lineWidth: 1,
                colorScale: [
                    "rgb(36,104, 180)",
                    "rgb(60,157, 194)",
                    "rgb(128,205,193 )",
                    "rgb(151,218,168 )",
                    "rgb(198,231,181)",
                    "rgb(238,247,217)",
                    "rgb(255,238,159)",
                    "rgb(252,217,125)",
                    "rgb(255,182,100)",
                    "rgb(252,150,75)",
                    "rgb(250,112,52)",
                    "rgb(245,64,32)",
                    "rgb(237,45,28)",
                    "rgb(220,24,32)",
                    "rgb(180,0,35)",
                ],
                // colorScale: "#fff",
                velocityScale: 1 / 25,
                maxAge: 60, // 粒子在重新生成之前绘制的最大帧数
                // particleMultiplier: 1 / 300, // TODO: PATHS = Math.round(width * height * particleMultiplier);
                paths: 800,
                frameRate: 20,
            }
        });
    });


