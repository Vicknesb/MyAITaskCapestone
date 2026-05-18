import "./globals.css";
import { Providers } from "./providers";

export const metadata = { title: "DevPulse", description: "Developer Analytics Dashboard" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
