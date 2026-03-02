import { redirect } from "next/navigation";

export default function Page() {
  redirect("/post/create-business?type=mall_store");
}
