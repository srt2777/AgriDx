export interface DemoNoteCopy {
  label: string;
  title: string;
  points: readonly string[];
}

/** Same claims in both languages: example hall data, indexed catalog counts, no live twin. */
export function demoNoteCopy(lang: 'zh' | 'en'): DemoNoteCopy {
  if (lang === 'en') {
    return {
      label: 'About this demo',
      title: 'Example data and real records',
      points: [
        'The hall’s status ring and equipment list are example data. They show the interface. They are not a live fleet.',
        'Catalog counts come from indexed evidence. Each entry keeps its source and scope.',
        'Sensors, alarms, and a physical twin are not connected.',
      ],
    };
  }
  return {
    label: '关于这场演示',
    title: '示例数据与真实记录',
    points: [
      '展厅运行环和设备表是示例数据，用来展示界面，不是在线机队。',
      '知识目录的条数来自已索引资料。每条仍保留来源和适用范围。',
      '传感器、告警和实车孪生尚未接入。',
    ],
  };
}
