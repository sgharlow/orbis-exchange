import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@orbis/db"],
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = {
      ".js": [".ts", ".js"],
    };
    return webpackConfig;
  },
};
export default config;
