using System.Text;
using Cairo;
using Pinta.Core;
using Pinta.Effects;
using Pinta.Effects.Tests;

namespace Pinta.Online.EffectFixtures;

/// <summary>
/// Regenerates the native effect fixtures asserted by tests/unit/effects.test.ts.
///
/// Those fixtures are the strongest parity evidence the port has: they pin the web kernels to
/// bytes produced by the real C# effects, including Cairo premultiplication, integer division,
/// float bilinear weights, fixed-point stepping and skipped out-of-bounds samples. They were
/// generated once by a transcription that was never kept, which left them unreproducible --
/// section 6 of docs/final_polish.md asks for that to be fixed, because evidence nobody can
/// regenerate is evidence nobody can check.
///
/// This runs the actual effects from original/, not a transcription of them. Output is a JSON
/// document that scripts/verify-native-fixtures.mjs compares against the TypeScript fixtures.
/// </summary>
internal static class Program
{
	/// <summary>
	/// The 5x4 RGBA source from effects.test.ts, chosen to exercise the awkward cases: fully
	/// transparent pixels, several partial alphas, and values that divide unevenly.
	/// </summary>
	private static readonly byte[] SourceRgba = [
		17, 29, 7, 255, 64, 48, 90, 192, 111, 67, 173, 128, 158, 86, 0, 64, 205, 105, 83, 0,
		30, 90, 38, 128, 77, 109, 121, 64, 124, 128, 204, 0, 171, 147, 31, 255, 218, 166, 114, 192,
		43, 151, 69, 0, 90, 170, 152, 255, 137, 189, 235, 192, 184, 208, 62, 128, 231, 227, 145, 64,
		56, 212, 100, 192, 103, 231, 183, 128, 150, 250, 10, 64, 197, 13, 93, 0, 244, 32, 176, 255,
	];

	private const int Width = 5;
	private const int Height = 4;

	static Program ()
	{
		Gio.Module.Initialize ();
		GdkPixbuf.Module.Initialize ();
		Cairo.Module.Initialize ();
		Gdk.Module.Initialize ();
	}

	private static IServiceProvider CreateServices ()
	{
		Size imageSize = new (Width, Height);
		ServiceManager manager = new ();
		manager.AddService<IPaletteService> (new MockPalette ());
		manager.AddService<IChromeService> (new MockChromeManager ());
		manager.AddService<IWorkspaceService> (new MockWorkspaceService (imageSize));
		manager.AddService<ISystemService> (new MockSystemService ());
		manager.AddService<ILivePreview> (new MockLivePreview (new RectangleI (0, 0, Width, Height)));
		return manager;
	}

	/// <summary>
	/// Builds the source surface. Cairo stores BGRA premultiplied, so straight RGBA has to be
	/// converted going in and back out again; doing it here rather than in the effect is the
	/// whole point, since that conversion is part of what the fixtures pin.
	/// </summary>
	private static ImageSurface CreateSource ()
	{
		ImageSurface surface = CairoExtensions.CreateImageSurface (Format.Argb32, Width, Height);
		Span<ColorBgra> pixels = surface.GetPixelData ();
		for (int index = 0; index < pixels.Length; index++) {
			int offset = index * 4;
			ColorBgra straight = ColorBgra.FromBgra (
				b: SourceRgba[offset + 2],
				g: SourceRgba[offset + 1],
				r: SourceRgba[offset + 0],
				a: SourceRgba[offset + 3]);
			pixels[index] = straight.ToPremultipliedAlpha ();
		}
		surface.MarkDirty ();
		return surface;
	}

	private static byte[] RenderToRgba (BaseEffect effect)
	{
		using ImageSurface source = CreateSource ();
		using ImageSurface destination = CairoExtensions.CreateImageSurface (Format.Argb32, Width, Height);

		effect.Render (source, destination, [source.GetBounds ()]);

		ReadOnlySpan<ColorBgra> rendered = destination.GetReadOnlyPixelData ();
		byte[] result = new byte[rendered.Length * 4];
		for (int index = 0; index < rendered.Length; index++) {
			ColorBgra straight = rendered[index].ToStraightAlpha ();
			int offset = index * 4;
			result[offset + 0] = straight.R;
			result[offset + 1] = straight.G;
			result[offset + 2] = straight.B;
			result[offset + 3] = straight.A;
		}
		return result;
	}

	private static IEnumerable<(string Id, byte[] Bytes)> Fixtures ()
	{
		IServiceProvider services = CreateServices ();

		FragmentEffect fragment = new (services);
		fragment.Data.Fragments = 5;
		fragment.Data.Distance = 2;
		fragment.Data.Rotation = new (33);
		yield return ("fragment", RenderToRgba (fragment));

		MotionBlurEffect motion = new (services);
		motion.Data.Angle = new (25);
		motion.Data.Distance = 3;
		motion.Data.Centered = true;
		yield return ("motion-blur", RenderToRgba (motion));

		RadialBlurEffect radial = new (services);
		radial.Data.Angle = new (27);
		radial.Data.Offset = new (-0.2, 0.25);
		radial.Data.Quality = 2;
		yield return ("radial-blur", RenderToRgba (radial));

		ZoomBlurEffect zoom = new (services);
		zoom.Data.Amount = 35;
		zoom.Data.Offset = new (0.2, -0.25);
		yield return ("zoom-blur", RenderToRgba (zoom));
	}

	private static int Main ()
	{
		StringBuilder json = new ();
		json.AppendLine ("{");
		json.AppendLine ($"  \"width\": {Width},");
		json.AppendLine ($"  \"height\": {Height},");
		json.AppendLine ($"  \"source\": [{string.Join (",", SourceRgba)}],");
		json.AppendLine ("  \"effects\": {");

		List<string> entries = [];
		foreach ((string id, byte[] bytes) in Fixtures ())
			entries.Add ($"    \"{id}\": [{string.Join (",", bytes)}]");

		json.AppendLine (string.Join (",\n", entries));
		json.AppendLine ("  }");
		json.AppendLine ("}");

		Console.Out.Write (json.ToString ());
		return 0;
	}
}
