import { StyleSheet, Text, View } from "react-native";

/** Placeholder so CI step 9 (expo export) runs from M0; Track D replaces it at M4 P0. */
export default function App() {
  return (
    <View style={styles.root}>
      <Text accessibilityRole="header" style={styles.title}>
        Query Module
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24 },
});
