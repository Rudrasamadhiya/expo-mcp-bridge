'use strict';
// Minimal stand-in for react-native so the bridge can run under Node with
// react-test-renderer. Component names match the real ones the walker looks for.
const React = require('react');
const h = React.createElement;

function Text(props) { return h('RCTText', props, props.children); }
function View(props) { return h('RCTView', props, props.children); }
function TextInput(props) { return h('AndroidTextInput', props); }
function Switch(props) { return h('RCTSwitch', props); }
function Pressable(props) {
  const { onPress, children, ...rest } = props;
  return h('RCTView', { ...rest, accessible: true }, children);
}
function Button(props) {
  return h(Pressable, { onPress: props.onPress, disabled: props.disabled, testID: props.testID }, h(Text, null, props.title));
}
// Like @expo/vector-icons: renders a private-use font glyph inside <Text>.
function Ionicons(props) { return h(Text, { style: { fontSize: props.size, color: props.color } }, ''); }
class ScrollView extends React.Component {
  constructor(p) { super(p); this.y = 0; }
  scrollTo({ y }) { this.y = y; ScrollView.last = y; }
  scrollToEnd() { this.y = 99999; ScrollView.last = 'end'; }
  render() {
    const { __contentRect, children, ...rest } = this.props;
    return h('RCTScrollView', rest, h('RCTScrollContentView', { __testRect: __contentRect }, children));
  }
}

const opened = [];
module.exports = {
  Text, View, TextInput, Switch, Pressable, Button, ScrollView, Ionicons,
  Platform: { OS: 'android', Version: 34 },
  Dimensions: { get: () => ({ width: 390, height: 844, scale: 3 }) },
  InteractionManager: { runAfterInteractions: (cb) => setTimeout(cb, 0) },
  NativeModules: {},
  Linking: { openURL: async (u) => { opened.push(u); } , opened },
  Keyboard: { dismiss() {} },
  DevSettings: { reload() {} },
};
