import { describe, expect, it } from 'vitest';
import {
  MAX_CHART_LABEL_LENGTH,
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  normaliseChartConfig,
} from './normaliseChartConfig';

describe('normaliseChartConfig resource limits', () => {
  it('bounds persisted chart points, series, and display labels', () => {
    const model = normaliseChartConfig({
      chart_type: 'bar',
      chart_config: {
        data: {
          labels: Array.from({ length: MAX_CHART_POINTS + 100 }, (_, index) => `${index}-${'x'.repeat(MAX_CHART_LABEL_LENGTH + 50)}`),
          datasets: Array.from({ length: MAX_CHART_SERIES + 5 }, (_, index) => ({
            label: `series-${index}-${'y'.repeat(MAX_CHART_LABEL_LENGTH + 50)}`,
            data: Array(MAX_CHART_POINTS + 100).fill(index),
          })),
        },
      },
    });

    expect(model).not.toBeNull();
    expect(model?.data).toHaveLength(MAX_CHART_POINTS);
    expect(model?.series).toHaveLength(MAX_CHART_SERIES);
    expect(model?.data.every((point) => point.name.length <= MAX_CHART_LABEL_LENGTH)).toBe(true);
    expect(model?.series.every((series) => series.label.length <= MAX_CHART_LABEL_LENGTH)).toBe(true);
  });
});
