/** Reconstruct exactly the archived spelling for checksums recorded before the 6B title correction. */
export function beforeJd1404TitleCorrection(text: string): string {
  const beforeCorrection = (section: string) => section
    .replaceAll('JD1404-A湿式离合器760与1000转分PTO短轴区分与更换', '1404湿式离合器760与1000转分PTO短轴区分与更换')
    .replaceAll('仅适用于手册所列 JD1404-A 湿式离合器机型更替 PTO 短轴', '仅适用于1404湿式离合器机型更替PTO短轴');
  return text
    .replace(/^\{"entry_id": "KB2000-20261015-JD6B-084",[^\n]*$/m, beforeCorrection)
    .replace(/^## KB2000-20261015-JD6B-084｜[\s\S]*?(?=^## |(?![\s\S]))/m, beforeCorrection);
}
