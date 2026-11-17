// Local workerd fixture only (scripts/generate-default-share-image.mjs):
// draws the site-wide link-preview picture with the Workers build of
// @vercel/og, exactly as the website's /opengraph-image route used to.
import { ImageResponse } from "next/dist/compiled/@vercel/og/index.edge.js";
import {
  DEFAULT_SHARE_IMAGE_SIZE,
  defaultShareImage,
} from "../../src/lib/sharing/default-share-image";

const worker = {
  async fetch() {
    return new ImageResponse(defaultShareImage(), DEFAULT_SHARE_IMAGE_SIZE);
  },
};

export default worker;
