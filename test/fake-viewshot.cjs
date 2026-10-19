'use strict';
// Stand-in for react-native-view-shot: returns a tiny valid JPEG header + marker.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
module.exports = {
  captureScreen: async (opts) => {
    module.exports.lastOptions = opts;
    module.exports.lastTarget = 'window';
    return JPEG.toString('base64');
  },
  captureRef: async (view, opts) => {
    module.exports.lastOptions = opts;
    module.exports.lastTarget = view;
    return JPEG.toString('base64');
  },
};
