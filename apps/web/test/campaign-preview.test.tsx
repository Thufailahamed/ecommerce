import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { CampaignPreview } from "@/components/campaign-preview";
import { defaultConfig } from "@/lib/campaign-defaults";

const frameOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[aria-label="Campaign preview"]')!;
const shadowOf = (container: HTMLElement) => frameOf(container).querySelector<HTMLElement>("[data-convertflow]")!.shadowRoot!;
const textNode = (root: ShadowRoot, text: string) => Array.from(root.querySelectorAll<HTMLElement>("*")).find((el) => el.textContent === text)!;

describe("CampaignPreview selection", () => {
  it("maps clicks on the real preview back to headline, body and button fields", async () => {
    const onSelect = vi.fn();
    const { container } = render(<CampaignPreview config={defaultConfig()} device="desktop" domain="shop.example.com" onSelectField={onSelect} />);
    await waitFor(() => expect(shadowOf(container)).toBeTruthy());

    fireEvent.click(textNode(shadowOf(container), "Welcome in"));
    expect(onSelect).toHaveBeenLastCalledWith("headline");
    fireEvent.click(textNode(shadowOf(container), "Take a look at what's new."));
    expect(onSelect).toHaveBeenLastCalledWith("body");
    const button = Array.from(shadowOf(container).querySelectorAll<HTMLAnchorElement>("a")).find((a) => a.textContent === "Shop now")!;
    fireEvent.click(button);
    expect(onSelect).toHaveBeenLastCalledWith("cta");
  });

  it("outlines the selected field and clears the outline when the selection ends", async () => {
    const { container, rerender } = render(<CampaignPreview config={defaultConfig()} device="desktop" domain="shop.example.com" onSelectField={() => {}} selectedField="headline" />);
    await waitFor(() => expect(shadowOf(container)).toBeTruthy());
    const headline = textNode(shadowOf(container), "Welcome in");
    await waitFor(() => expect(headline.style.outline).toBe("2px solid #6f8fff"));
    expect(headline.getAttribute("data-cf-selectable")).toBe("true");

    rerender(<CampaignPreview config={defaultConfig()} device="desktop" domain="shop.example.com" onSelectField={() => {}} selectedField={null} />);
    await waitFor(() => expect(headline.style.outline).toBe(""));
  });

  it("keeps the outline after switching the preview device", async () => {
    const { container, rerender } = render(<CampaignPreview config={defaultConfig()} device="desktop" domain="shop.example.com" onSelectField={() => {}} selectedField="headline" />);
    await waitFor(() => expect(shadowOf(container)).toBeTruthy());
    rerender(<CampaignPreview config={defaultConfig()} device="mobile" domain="shop.example.com" onSelectField={() => {}} selectedField="headline" />);
    await waitFor(() => {
      const headline = textNode(shadowOf(container), "Welcome in");
      expect(headline.style.outline).toBe("2px solid #6f8fff");
    });
  });

  it("maps a click inside a signup form to the form field", async () => {
    const onSelect = vi.fn();
    const { container } = render(<CampaignPreview config={defaultConfig("email")} device="desktop" domain="shop.example.com" onSelectField={onSelect} />);
    await waitFor(() => expect(shadowOf(container)).toBeTruthy());
    const input = shadowOf(container).querySelector<HTMLInputElement>('input[type="email"]')!;
    fireEvent.click(input);
    expect(onSelect).toHaveBeenLastCalledWith("form");
  });
});
