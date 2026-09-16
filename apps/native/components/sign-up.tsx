import { useForm } from "@tanstack/react-form";
import { Button, Spinner, useToast } from "heroui-native";
import { useRef } from "react";
import { TextInput, View } from "react-native";
import z from "zod";

import { TextField } from "@/components/text-field";
import { authClient } from "@/lib/auth-client";
import { getFormErrorMessage } from "@/lib/form-error";
import { queryClient } from "@/utils/trpc";

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required").min(2, "Name must be at least 2 characters"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required").min(8, "Use at least 8 characters"),
});

/** The fields and the submit button of the design's `signup` screen. */
export function SignUp() {
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const { toast } = useToast();

  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
    validators: {
      onSubmit: signUpSchema,
    },
    onSubmit: async ({ value, formApi }) => {
      await authClient.signUp.email(
        {
          name: value.name.trim(),
          email: value.email.trim(),
          password: value.password,
        },
        {
          onError(error) {
            toast.show({
              variant: "danger",
              label: error.error?.message || "Failed to sign up",
            });
          },
          onSuccess() {
            formApi.reset();
            queryClient.refetchQueries();
          },
        },
      );
    },
  });

  return (
    <View className="gap-4">
      <form.Field name="name">
        {(field) => (
          <TextField
            label="Name"
            error={getFormErrorMessage(field.state.meta.errors)}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChangeText={field.handleChange}
            placeholder="Mina Park"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => {
              emailInputRef.current?.focus();
            }}
          />
        )}
      </form.Field>

      <form.Field name="email">
        {(field) => (
          <TextField
            ref={emailInputRef}
            label="Email"
            error={getFormErrorMessage(field.state.meta.errors)}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChangeText={field.handleChange}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => {
              passwordInputRef.current?.focus();
            }}
          />
        )}
      </form.Field>

      <form.Field name="password">
        {(field) => (
          <TextField
            ref={passwordInputRef}
            label="Password"
            error={getFormErrorMessage(field.state.meta.errors)}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChangeText={field.handleChange}
            placeholder="At least 8 characters"
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={form.handleSubmit}
          />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button size="lg" onPress={form.handleSubmit} isDisabled={isSubmitting} className="mt-2">
            {isSubmitting ? (
              <Spinner size="sm" color="default" />
            ) : (
              <Button.Label className="font-serif-medium">Create account</Button.Label>
            )}
          </Button>
        )}
      </form.Subscribe>
    </View>
  );
}
