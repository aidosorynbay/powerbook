import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

type Props = React.ComponentProps<typeof DayPicker>;

// Minimal shadcn-like wrapper (we keep styling lightweight and consistent with our CSS vars).
export function Calendar(props: Props) {
    return (
        <div
            style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                overflow: "hidden",
                background: "var(--panel)",
            }}
        >
            <div style={{ padding: 10 }}>
                <DayPicker
                    showOutsideDays
                    {...props}
                    styles={{
                        caption: { color: "var(--text)" },
                        head_cell: { color: "var(--muted)", fontWeight: 700, fontSize: 12 },
                        cell: { color: "var(--text)" },
                    }}
                />
            </div>
        </div>
    );
}

