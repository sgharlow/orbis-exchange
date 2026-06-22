import { redirect } from "next/navigation";

// The world view is the app. Send the apex straight there (the old bare-HTML
// leaderboard stub was a jarring first touch for judges).
export default function Home() {
  redirect("/world");
}
