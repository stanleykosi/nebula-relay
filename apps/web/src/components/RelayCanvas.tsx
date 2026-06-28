"use client";

import { useEffect, useRef } from "react";

export function RelayCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let frame = 0;
    let animation = 0;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * scale));
      canvas.height = Math.max(1, Math.floor(rect.height * scale));
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.fillStyle = "#11100d";
      context.fillRect(0, 0, rect.width, rect.height);

      const nodes = [
        { x: rect.width * 0.12, y: rect.height * 0.64, label: "EVM" },
        { x: rect.width * 0.42, y: rect.height * 0.35, label: "RISC0" },
        { x: rect.width * 0.7, y: rect.height * 0.56, label: "Stellar" },
        { x: rect.width * 0.9, y: rect.height * 0.32, label: "Note" },
      ];

      context.lineWidth = 1;
      for (let i = 0; i < nodes.length - 1; i += 1) {
        const a = nodes[i];
        const b = nodes[i + 1];
        if (!a || !b) {
          continue;
        }
        context.strokeStyle = "rgba(248, 245, 234, 0.22)";
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.bezierCurveTo(
          a.x + rect.width * 0.12,
          a.y - rect.height * 0.18,
          b.x - rect.width * 0.12,
          b.y + rect.height * 0.12,
          b.x,
          b.y
        );
        context.stroke();

        const t = (frame / 120 + i * 0.23) % 1;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t + Math.sin(t * Math.PI) * -42;
        context.fillStyle = i % 2 === 0 ? "#35d0ba" : "#f0b84f";
        context.fillRect(px - 4, py - 4, 8, 8);
      }

      for (const [index, node] of nodes.entries()) {
        context.fillStyle = ["#35d0ba", "#f0b84f", "#7acb68", "#ef716b"][
          index
        ] ?? "#f8f5ea";
        context.fillRect(node.x - 18, node.y - 18, 36, 36);
        context.strokeStyle = "rgba(17, 16, 13, 0.8)";
        context.strokeRect(node.x - 18, node.y - 18, 36, 36);
        context.fillStyle = "rgba(248, 245, 234, 0.78)";
        context.font = "700 12px ui-sans-serif, system-ui";
        context.fillText(node.label, node.x - 20, node.y + 38);
      }

      frame += 1;
      animation = window.requestAnimationFrame(draw);
    };

    draw();
    return () => window.cancelAnimationFrame(animation);
  }, []);

  return (
    <canvas
      ref={ref}
      className="hero-canvas"
      aria-label="Animated relay path from EVM to RISC Zero to Stellar note"
    />
  );
}
