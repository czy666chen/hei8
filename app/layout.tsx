import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "台球奇招卡牌",
  description: "51 张台球奇招卡牌，不放回随机抽取。",
  openGraph: {
    title: "台球奇招卡牌",
    description: "51 张 · 不放回抽取",
    type: "website",
    images: [{ url: "/og.png", width: 1733, height: 907, alt: "台球奇招卡牌" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "台球奇招卡牌",
    description: "51 张 · 不放回抽取",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
