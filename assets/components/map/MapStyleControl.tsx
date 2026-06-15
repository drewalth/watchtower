import { Layers, Moon, Satellite, Sun } from "lucide-react";

import { ControlButton, ControlGroup } from "@/components/ui/map";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STYLE_OPTIONS, type MapStyleId } from "@/lib/basemap";

const STYLE_ICONS: Record<MapStyleId, typeof Layers> = {
  light: Sun,
  dark: Moon,
  satellite: Satellite,
};

type MapStyleControlProps = {
  styleId: MapStyleId;
  onStyleChange: (id: MapStyleId) => void;
};

/**
 * Basemap switcher: a Layers icon button that opens a dropdown of the available
 * styles (light / dark / satellite). Purely presentational — persistence lives
 * in the parent (see useMapStyle).
 */
export function MapStyleControl({
  styleId,
  onStyleChange,
}: MapStyleControlProps) {
  return (
    <DropdownMenu>
      <ControlGroup>
        <DropdownMenuTrigger asChild>
          <ControlButton label="Map style">
            <Layers className="size-4" />
          </ControlButton>
        </DropdownMenuTrigger>
      </ControlGroup>
      <DropdownMenuContent side="left" align="end">
        <DropdownMenuLabel>Map style</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={styleId}
          onValueChange={(value) => onStyleChange(value as MapStyleId)}
        >
          {STYLE_OPTIONS.map((option) => {
            const Icon = STYLE_ICONS[option.id];
            return (
              <DropdownMenuRadioItem key={option.id} value={option.id}>
                <Icon className="size-4" />
                {option.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
