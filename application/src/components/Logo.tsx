import React from 'react';
import Svg, { Rect, Polygon } from 'react-native-svg';

export default function Logo({ width = 120, height = 120, opacity = 1 }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 120 120" fill="none" style={{ opacity }}>
      <Rect width="120" height="120" rx="26" fill="#1C1208" />
      <Rect width="120" height="120" rx="26" fill="#2a1a08" opacity="0.5" />
      <Polygon points="60,22 32,82 60,68" fill="#C1440E" />
      <Polygon points="60,22 88,82 60,68" fill="#7A2A06" />
      <Polygon points="32,82 60,68 88,82 60,90" fill="#4a1a04" />
    </Svg>
  );
}
