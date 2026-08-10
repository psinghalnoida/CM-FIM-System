"use server";

import { redirect } from "next/navigation";
import {
  LoginSchema,
  performLogin,
  performLogout,
  setSessionCookie,
  type LoginState,
} from "@/lib/auth-actions";

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const validatedFields = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const { email, password } = validatedFields.data;
  const result = await performLogin(email, password);

  if (!result.ok) {
    return { errors: { form: [result.error] } };
  }

  await setSessionCookie(result.cookieValue);
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await performLogout();
  redirect("/login");
}
