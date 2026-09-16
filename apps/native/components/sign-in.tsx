import { useForm } from "@tanstack/react-form";
import { Button, Spinner, useToast } from "heroui-native";
import { useRef } from "react";
import { TextInput, View } from "react-native";
import z from "zod";

import { TextField } from "@/components/text-field";
import { authClient } from "@/lib/auth-client";
import { getFormErrorMessage } from "@/lib/form-error";
import { queryClient } from "@/utils/trpc";

const signInSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required").min(8, "Use at least 8 characters"),
});

/**
 * The fields and the submit button of the design's `signin` screen — the page
 * around them (wordmark, headline, the link across to sign-up) belongs to the
 * route, so the same form can't drift between two chromes.
 *
 * Errors are rendered per field rather than once above the form: TanStack buckets
 * a schema's issues by field path, so `field.state.meta.errors` already holds the
 * message that belongs to that input.
 */
function SignIn() {
  const passwordInputRef = useRef<TextInput>(null);
  const { toast } = useToast();

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    validators: {
      onSubmit: signInSchema,
    },
    onSubmit: async ({ value, formApi }) => {
      await authClient.signIn.email(
        {
          email: value.email.trim(),
          password: value.password,
        },
        {
          onError(error) {
            toast.show({
              variant: "danger",
              label: error.error?.message || "Failed to sign in",
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
      <form.Field name="email">
        {(field) => (
          <TextField
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
            placeholder="••••••••"
            secureTextEntry
            autoComplete="password"
            textContentType="password"
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
              <Button.Label className="font-serif-medium">Sign in</Button.Label>
            )}
          </Button>
        )}
      </form.Subscribe>
    </View>
  );
}

export { SignIn };
