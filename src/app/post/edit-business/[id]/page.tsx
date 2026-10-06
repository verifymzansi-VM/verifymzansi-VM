"use client";
import {
  BusinessContactFields,
  readContactMethods,
  selectedContacts,
} from "@/components/post/business-contact-fields";
import { PostSelect } from "@/components/post/post-select";

import { settleMediaUploads } from "@/app/post/_lib/settle-media-uploads";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CreditCard, Truck, Wrench, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PostLabel as Label } from "@/components/post/post-label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { MediaUpload } from "@/components/ui/media-upload";
import { OnlinePresenceFields } from "@/components/post/online-presence-fields";
import {
  BusinessProfileExtrasFields,
  EMPTY_BUSINESS_PROFILE_EXTRAS,
  businessProfileExtrasPayload,
  readBusinessProfileExtras,
  type BusinessProfileExtras,
} from "@/components/post/business-profile-extras-fields";
import { UploadProgressPanel, type UploadSlotStatus } from "@/components/ui/upload-progress-panel";
import { FocalPointPicker, type FocalPoint } from "@/components/ui/focal-point-picker";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { useToast } from "@/hooks/use-toast";
import { UseRegisteredOffice } from "@/components/business-verification/use-registered-office";
import { LocationSelector } from "@/components/ui/location-selector";
import {
  ALL_BUSINESS_CATEGORIES,
  BUSINESS_CATEGORIES,
  BUSINESS_TYPE_OPTIONS,
  TOURISM_SUBCATEGORIES,
} from "@/lib/constants/categories";
import {
  getCategoryDetailFields,
  getDefaultCategoryDetails,
} from "@/lib/forms/business-category-details";
import { usePlanVideoAllowed, usePlanMaxPhotos } from "@/components/billing/plan-gate";
import { normalizeCreatePostRuntimeError } from "@/app/post/_lib/create-post-errors";
import {
  getBusinessMediaUploadErrorState,
  uploadRequiredBusinessMedia,
  uploadRequiredBusinessVideo,
} from "@/app/post/_lib/business-media-upload";
import { CustomerAccessFields } from "@/components/post/customer-access-fields";
import { BusinessCategoryPicker } from "@/components/post/business-category-picker";
import {
  legacyAccessFromRecord,
  readCustomerAccess,
  customerAccessSchema,
  primaryBusinessType,
  cleanCustomerAccess,
} from "@/lib/forms/customer-access";
import { parseServiceAreas, validateBusinessForm } from "@/lib/forms/business-form";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import {
  coerceBusinessDetails,
  getNormalizedDeliveryOptions,
  getDefaultBusinessDetails,
  hasBusinessDeliveryAvailable,
  sanitizeBusinessDetailsForSubmission,
} from "@/lib/forms/business-type-details";
import type { BusinessDetails } from "@/types/business-details";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";
import { BusinessLayoutRouter } from "@/components/business/layouts/business-layout-router";
import type { LayoutTemplate } from "@/lib/business/layout-templates";
import {
  BUSINESS_CATEGORY_LABELS,
  type BusinessType,
  type BusinessCategory,
  type MarketplaceArea,
} from "@/types/enums";
import {
  OperatingHoursInput,
  formatHoursValue,
  parseHoursValue,
} from "@/components/ui/operating-hours-input";
import { readMediaDimensions } from "@/lib/utils/media-metadata";

const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-shadow sm:h-10 sm:text-sm";

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "eft", label: "EFT / Bank Transfer" },
  { value: "snapscan", label: "SnapScan" },
  { value: "capitec_pay", label: "Capitec Pay" },
  { value: "other", label: "Other" },
];

export default function EditBusinessPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const businessId = params.id;
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlightRef = useRef(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [uploadStatuses, setUploadStatuses] = useState<Record<string, UploadSlotStatus>>({
    logo: "idle",
    photos: "idle",
    video: "idle",
    saving: "idle",
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Business Type
  const [businessType, setBusinessType] = useState<BusinessType>("standalone_shop");
  const [businessDetails, setBusinessDetails] = useState<BusinessDetails>(
    getDefaultBusinessDetails("standalone_shop")
  );

  // Basic Info
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [categoryDetails, setCategoryDetails] = useState<Record<string, unknown>>({});
  // Businesses saved before customer access existed keep their type-specific details.
  const hadStoredAccess = useRef(false);
  const categoryAnswers = useRef<
    Record<string, { subcategory: string; details: Record<string, unknown> }>
  >({});

  // Location
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [locationTown, setLocationTown] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [storeNumber, setStoreNumber] = useState("");
  const [profileExtras, setProfileExtras] = useState<BusinessProfileExtras>(
    EMPTY_BUSINESS_PROFILE_EXTRAS
  );
  const [serviceAreasInput, setServiceAreasInput] = useState("");
  const [mapDirections, setMapDirections] = useState("");

  // Contact & Social
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const contactValues = { phone, whatsapp, email, website };
  const contactMethods = readContactMethods(categoryDetails.contact_methods, contactValues);
  const publicContacts = selectedContacts(contactMethods, contactValues);
  // Profiles without customer access predate the address toggle and always show the pin.
  const mapPinPublishable =
    !categoryDetails.customer_access ||
    readCustomerAccess(categoryDetails.customer_access).publishAddress;
  const [socialFacebook, setSocialFacebook] = useState("");
  const [socialInstagram, setSocialInstagram] = useState("");
  const [socialTwitter, setSocialTwitter] = useState("");
  const [socialTiktok, setSocialTiktok] = useState("");

  // Operating Hours
  const [hoursMonFri, setHoursMonFri] = useState({ open: "", close: "", closed: false });
  const [hoursSat, setHoursSat] = useState({ open: "", close: "", closed: false });
  const [hoursSun, setHoursSun] = useState({ open: "", close: "", closed: true });

  // Services & Additional
  const [servicesInput, setServicesInput] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [deliveryOptions, setDeliveryOptions] = useState<string[]>([]);
  const [layoutTemplate, setLayoutTemplate] = useState<LayoutTemplate | null>(null);
  const [listingArea, setListingArea] = useState<MarketplaceArea>("MZANSI_BUSINESS");

  // Media — existing URLs
  const [existingLogo, setExistingLogo] = useState("");
  const [existingCoverPhoto, setExistingCoverPhoto] = useState("");
  const [existingCoverVideo, setExistingCoverVideo] = useState("");
  const [existingVideoThumbnail, setExistingVideoThumbnail] = useState("");
  const [existingGalleryPhotos, setExistingGalleryPhotos] = useState<string[]>([]);
  const [existingMallPhotos, setExistingMallPhotos] = useState<string[]>([]);

  // Media — new files
  const [newLogoFile, setNewLogoFile] = useState<File[]>([]);
  const [newCoverFile, setNewCoverFile] = useState<File[]>([]);
  const [newGalleryFiles, setNewGalleryFiles] = useState<File[]>([]);
  const [newMallPhotoFiles, setNewMallPhotoFiles] = useState<File[]>([]);
  const [newPromoVideoFile, setNewPromoVideoFile] = useState<File[]>([]);
  const [newVideoThumbnailFile, setNewVideoThumbnailFile] = useState<File[]>([]);
  const [removeVideo, setRemoveVideo] = useState(false);
  const [focalPoint, setFocalPoint] = useState<FocalPoint>({ x: 0.5, y: 0.5 });

  const maxPhotos = usePlanMaxPhotos(listingArea);
  const videoAllowed = usePlanVideoAllowed(listingArea);
  const previewLogoUrl = useMemo(
    () => (newLogoFile.length > 0 ? URL.createObjectURL(newLogoFile[0]) : null),
    [newLogoFile]
  );
  const previewCoverPhotoUrl = useMemo(
    () => (newCoverFile.length > 0 ? URL.createObjectURL(newCoverFile[0]) : null),
    [newCoverFile]
  );
  const previewGalleryUrls = useMemo(
    () => newGalleryFiles.map((file) => URL.createObjectURL(file)),
    [newGalleryFiles]
  );
  const previewMallPhotoUrls = useMemo(
    () => newMallPhotoFiles.map((file) => URL.createObjectURL(file)),
    [newMallPhotoFiles]
  );
  const previewPromoVideoUrl = useMemo(
    () => (newPromoVideoFile.length > 0 ? URL.createObjectURL(newPromoVideoFile[0]) : null),
    [newPromoVideoFile]
  );
  const previewVideoThumbnailUrl = useMemo(
    () => (newVideoThumbnailFile.length > 0 ? URL.createObjectURL(newVideoThumbnailFile[0]) : null),
    [newVideoThumbnailFile]
  );

  // Load existing data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/businesses/${businessId}`);
        if (!res.ok) {
          setError("Business not found");
          return;
        }
        const data = await res.json();
        const b = data.business;

        setListingArea(b.area === "PROMOTIONS_EVENTS" ? "PROMOTIONS_EVENTS" : "MZANSI_BUSINESS");
        hadStoredAccess.current = Boolean(b.category_details?.customer_access);
        setBusinessType(b.business_type || "standalone_shop");
        setBusinessName(b.business_name || "");
        setSlug(b.slug || "");
        setDescription(b.description || "");
        setCategory(b.category || "");
        setSubcategory(b.subcategory || "");
        setCategoryDetails({
          ...(b.category_details ?? {}),
          customer_access:
            b.category_details?.customer_access ??
            legacyAccessFromRecord({
              businessType: b.business_type || "standalone_shop",
              venue: b.business_details?.mall_name || b.business_details?.market_name || "",
              serviceAreas: b.service_areas?.areas ?? [],
              deliveryRegions:
                b.business_details?.type === "online_only"
                  ? (b.business_details.delivery_regions ?? [])
                  : [],
              deliveryAvailable: hasBusinessDeliveryAvailable(
                b.delivery_options,
                b.business_details
              ),
              nationwide:
                Array.isArray(b.delivery_options) && b.delivery_options.includes("nationwide"),
              city: b.location_city || "",
              hasAddress: Boolean(b.location_address),
            }),
        });
        setProvince(b.location_province || "");
        setCity(b.location_city || "");
        setLocationTown(b.location_town || "");
        setLocationAddress(b.location_address || "");
        setStoreNumber(b.store_number || "");
        setProfileExtras(readBusinessProfileExtras(b.category_details));
        setMapDirections(b.map_directions || "");
        setPhone(b.phone || "");
        setWhatsapp(b.whatsapp || "");
        setEmail(b.email || "");
        setWebsite(b.website || "");
        setBusinessDetails(
          coerceBusinessDetails(b.business_type || "standalone_shop", b.business_details)
        );
        setExistingLogo(b.logo_url || "");
        setExistingCoverPhoto(b.cover_photo || "");
        setExistingCoverVideo(b.cover_video || "");
        setExistingVideoThumbnail(b.video_thumbnail || "");
        setExistingGalleryPhotos(b.gallery_photos || []);
        setExistingMallPhotos(
          b.category_details?.venue_photos ??
            (b.business_details?.type === "mall_store"
              ? (b.business_details.mall_photos ?? [])
              : [])
        );
        setServices(b.services_offered || []);
        setPaymentMethods(b.payment_methods_accepted || []);
        setDeliveryOptions(
          getNormalizedDeliveryOptions(
            hasBusinessDeliveryAvailable(b.delivery_options, b.business_details)
          )
        );

        // Operating hours
        const hours = b.operating_hours || {};
        setHoursMonFri(parseHoursValue(hours.Mon_Fri || ""));
        setHoursSat(parseHoursValue(hours.Sat || ""));
        setHoursSun(parseHoursValue(hours.Sun || ""));

        // Social links
        const social = b.social_links || {};
        setSocialFacebook(social.facebook || "");
        setSocialInstagram(social.instagram || "");
        setSocialTwitter(social.twitter || "");
        setSocialTiktok(social.tiktok || "");

        // Layout template
        setLayoutTemplate(b.layout_template || null);
        setFocalPoint({
          x: typeof b.focal_x === "number" ? (b.focal_x as number) : 0.5,
          y: typeof b.focal_y === "number" ? (b.focal_y as number) : 0.5,
        });

        // Service areas
        if (b.service_areas?.areas) {
          setServiceAreasInput(b.service_areas.areas.join(", "));
        }
      } catch {
        setError("Failed to load business");
      } finally {
        setIsLoading(false);
      }
    }

    void load();
  }, [businessId]);

  useEffect(
    () => () => {
      if (previewLogoUrl) URL.revokeObjectURL(previewLogoUrl);
    },
    [previewLogoUrl]
  );

  useEffect(
    () => () => {
      if (previewCoverPhotoUrl) URL.revokeObjectURL(previewCoverPhotoUrl);
    },
    [previewCoverPhotoUrl]
  );

  useEffect(
    () => () => {
      previewGalleryUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [previewGalleryUrls]
  );
  useEffect(
    () => () => {
      previewMallPhotoUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [previewMallPhotoUrls]
  );

  useEffect(
    () => () => {
      if (previewPromoVideoUrl) URL.revokeObjectURL(previewPromoVideoUrl);
    },
    [previewPromoVideoUrl]
  );

  useEffect(
    () => () => {
      if (previewVideoThumbnailUrl) URL.revokeObjectURL(previewVideoThumbnailUrl);
    },
    [previewVideoThumbnailUrl]
  );

  function clearErrors(...keys: string[]) {
    setError(null);
    if (keys.length === 0) {
      setFieldErrors({});
      return;
    }
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  function addService() {
    const trimmed = servicesInput.trim();
    if (trimmed && !services.includes(trimmed) && services.length < 30) {
      setServices((prev) => [...prev, trimmed]);
      setServicesInput("");
    }
  }

  function removeService(index: number) {
    setServices((prev) => prev.filter((_, i) => i !== index));
  }

  function togglePaymentMethod(method: string) {
    setPaymentMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  }

  function setDeliveryAvailable(deliveryAvailable: boolean) {
    setDeliveryOptions(getNormalizedDeliveryOptions(deliveryAvailable));
  }

  async function handleSubmit() {
    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setSubmitProgress("Uploading media...");
    setUploadStatuses({
      logo: newLogoFile.length > 0 ? "uploading" : "skipped",
      photos:
        newCoverFile.length > 0 || newGalleryFiles.length > 0 || newMallPhotoFiles.length > 0
          ? "uploading"
          : "skipped",
      video: newPromoVideoFile.length > 0 ? "uploading" : "skipped",
      saving: "idle",
    });
    setError(null);
    clearErrors();

    try {
      const validationErrors = validateBusinessForm({
        businessType,
        businessDetails,
        storeNumber: storeNumber.trim(),
        serviceAreasInput,
        mapDirections: mapDirections.trim(),
        phone: publicContacts.phone.trim(),
        whatsapp: publicContacts.whatsapp.trim(),
        email: publicContacts.email.trim(),
        website: publicContacts.website.trim(),
        socialFacebook: socialFacebook.trim(),
        socialInstagram: socialInstagram.trim(),
        socialTwitter: socialTwitter.trim(),
        socialTiktok: socialTiktok.trim(),
      });

      if (categoryDetails.customer_access) {
        for (const key of Object.keys(validationErrors))
          if (
            key.startsWith("business_details.") ||
            ["store_number", "service_areas"].includes(key) ||
            (key === "map_directions" && !mapPinPublishable)
          )
            delete validationErrors[key];
        const result = customerAccessSchema.safeParse(categoryDetails.customer_access);
        if (!result.success)
          for (const issue of result.error.issues)
            validationErrors[`customer_access.${issue.path.join(".")}`] = issue.message;
        if (!contactMethods.length)
          validationErrors.contact_methods = "Choose at least one contact method.";
        for (const [method, field] of [
          ["call", "phone"],
          ["whatsapp", "whatsapp"],
          ["email", "email"],
          ["website", "website"],
        ] as const) {
          if (contactMethods.includes(method) && !publicContacts[field].trim())
            validationErrors[field] = "Enter the details for this contact method, or deselect it.";
        }
        const access = readCustomerAccess(categoryDetails.customer_access);
        if (access.methods.some((method) => method !== "online")) {
          if (!province) validationErrors.location_province = "Select a province.";
          if (!city) validationErrors.location_city = "Select a city or town.";
        }
        if (access.publishAddress && !locationAddress.trim())
          validationErrors.location_address =
            "Enter the visitor address you want to publish, or turn off public address visibility.";
        if (!description.trim())
          validationErrors.description = "Tell customers about your business.";
      }
      if (existingGalleryPhotos.length + newGalleryFiles.length > maxPhotos) {
        validationErrors.gallery_photos = `You can upload up to ${maxPhotos} profile photos on this plan.`;
      }
      if (newPromoVideoFile.length > 0 && !videoAllowed) {
        validationErrors.cover_video = "Video is not available on your current plan.";
      }
      if (Object.keys(validationErrors).length > 0) {
        setFieldErrors(validationErrors);
        setError(Object.values(validationErrors)[0]);
        setIsSubmitting(false);
        setSubmitProgress(null);
        return;
      }

      // Upload all new media in parallel
      const [logoUrls, [coverUrls, galleryUrls, mallPhotoUrls], videoUrl, thumbUrls] =
        await settleMediaUploads([
          uploadRequiredBusinessMedia({
            files: newLogoFile,
            area: "business_logo",
            field: "logo_url",
          }).then((urls) => {
            if (newLogoFile.length > 0) setUploadStatuses((c) => ({ ...c, logo: "done" }));
            return urls;
          }),
          settleMediaUploads([
            uploadRequiredBusinessMedia({
              files: newCoverFile,
              area: "business_cover",
              field: "cover_photo",
            }),
            uploadRequiredBusinessMedia({
              files: newGalleryFiles,
              area: "business_gallery",
              field: "gallery_photos",
            }),
            uploadRequiredBusinessMedia({
              files: newMallPhotoFiles,
              area: "business_gallery",
              field: "gallery_photos",
            }),
          ]).then((urls) => {
            if (newCoverFile.length || newGalleryFiles.length || newMallPhotoFiles.length) {
              setUploadStatuses((c) => ({ ...c, photos: "done" }));
            }
            return urls;
          }),
          newPromoVideoFile.length > 0
            ? uploadRequiredBusinessVideo({
                file: newPromoVideoFile[0],
                area: "business_cover",
              }).then((url) => {
                setUploadStatuses((c) => ({ ...c, video: "done" }));
                return url;
              })
            : Promise.resolve(null),
          uploadRequiredBusinessMedia({
            files: newVideoThumbnailFile,
            area: "business_cover",
            field: "video_thumbnail",
          }),
        ]);

      let finalLogoUrl = existingLogo;
      if (logoUrls[0]) finalLogoUrl = logoUrls[0];

      let finalCoverPhoto = existingCoverPhoto;
      if (coverUrls[0]) finalCoverPhoto = coverUrls[0];

      let finalCoverVideo = existingCoverVideo;
      let finalVideoThumbnail = existingVideoThumbnail;
      if (videoUrl) {
        finalCoverVideo = videoUrl;
      } else if (removeVideo) {
        finalCoverVideo = "";
        finalVideoThumbnail = "";
      }

      if (thumbUrls[0] && finalCoverVideo) {
        finalVideoThumbnail = thumbUrls[0];
      }

      // Saved photos the owner kept stay first; new uploads are appended.
      const finalGalleryPhotos = [...existingGalleryPhotos, ...galleryUrls];
      const finalMallPhotos = [...existingMallPhotos, ...mallPhotoUrls];

      setSubmitProgress("Saving business...");
      setUploadStatuses((c) => ({ ...c, saving: "uploading" }));

      // Build social links
      const socialLinks: Record<string, string> = {};
      if (socialFacebook) socialLinks.facebook = socialFacebook;
      if (socialInstagram) socialLinks.instagram = socialInstagram;
      if (socialTwitter) socialLinks.twitter = socialTwitter;
      if (socialTiktok) socialLinks.tiktok = socialTiktok;

      // Build operating hours
      const operatingHours: Record<string, string> = {};
      if (businessType === "market_stall" && !categoryDetails.customer_access) {
        const td = (businessDetails as unknown as Record<string, unknown>).trading_days as
          string[] | undefined;
        const th = (businessDetails as unknown as Record<string, unknown>).trading_hours as
          string | undefined;
        if (td && th) {
          const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
          const hasWeekday = td.some((d) => WEEKDAYS.includes(d));
          const hasSat = td.includes("Saturday");
          const hasSun = td.includes("Sunday");
          if (hasWeekday) operatingHours.Mon_Fri = th;
          else operatingHours.Mon_Fri = "Closed";
          operatingHours.Sat = hasSat ? th : "Closed";
          operatingHours.Sun = hasSun ? th : "Closed";
        }
      } else {
        const monFriVal = formatHoursValue(hoursMonFri.open, hoursMonFri.close, hoursMonFri.closed);
        const satVal = formatHoursValue(hoursSat.open, hoursSat.close, hoursSat.closed);
        const sunVal = formatHoursValue(hoursSun.open, hoursSun.close, hoursSun.closed);
        if (monFriVal) operatingHours.Mon_Fri = monFriVal;
        if (satVal) operatingHours.Sat = satVal;
        if (sunVal) operatingHours.Sun = sunVal;
      }

      // Build service areas
      const serviceAreas =
        businessType === "mobile_service" && serviceAreasInput
          ? {
              areas: parseServiceAreas(serviceAreasInput),
            }
          : undefined;
      const normalizedBusinessDetails = coerceBusinessDetails(businessType, businessDetails);
      const deliveryAvailable = deliveryOptions.length > 0;
      const finalBusinessDetails =
        normalizedBusinessDetails.type === "mall_store"
          ? { ...normalizedBusinessDetails, mall_photos: finalMallPhotos }
          : sanitizeBusinessDetailsForSubmission(normalizedBusinessDetails, deliveryAvailable);
      const normalizedDeliveryOptions = getNormalizedDeliveryOptions(deliveryAvailable);
      const primaryMediaFile = newPromoVideoFile[0] ?? newCoverFile[0] ?? null;
      const mediaDimensions = primaryMediaFile ? await readMediaDimensions(primaryMediaFile) : null;

      // The API rebuilds business_profile from the extras fields below.
      const { business_profile: _staleProfile, ...categoryDetailsWithoutProfile } = categoryDetails;
      const body = {
        contact_methods: contactMethods,
        business_name: businessName,
        slug,
        business_type: businessType,
        category,
        subcategory: subcategory || undefined,
        description,
        location_province: province || undefined,
        location_city: city || undefined,
        location_town: locationTown || undefined,
        location_address: locationAddress || undefined,
        store_number: businessType === "mall_store" ? storeNumber : undefined,
        map_directions: mapPinPublishable ? mapDirections.trim() || undefined : undefined,
        phone: publicContacts.phone || undefined,
        whatsapp: publicContacts.whatsapp || undefined,
        email: publicContacts.email || undefined,
        website: publicContacts.website || undefined,
        logo_url: finalLogoUrl || undefined,
        cover_photo: finalCoverPhoto || undefined,
        cover_video: finalCoverVideo || undefined,
        video_thumbnail: finalVideoThumbnail || undefined,
        gallery_photos: finalGalleryPhotos.length > 0 ? finalGalleryPhotos : [],
        services_offered: services,
        service_areas: serviceAreas,
        business_details: hadStoredAccess.current ? undefined : finalBusinessDetails,
        ...businessProfileExtrasPayload(profileExtras),
        category_details: categoryDetails.customer_access
          ? {
              ...categoryDetailsWithoutProfile,
              customer_access: cleanCustomerAccess(
                readCustomerAccess(categoryDetails.customer_access)
              ),
              venue_photos: finalMallPhotos,
            }
          : categoryDetailsWithoutProfile,
        operating_hours: operatingHours,
        payment_methods_accepted: paymentMethods,
        delivery_options: normalizedDeliveryOptions,
        social_links: Object.keys(socialLinks).length > 0 ? socialLinks : undefined,
        layout_template: layoutTemplate || undefined,
        media_width: mediaDimensions?.width,
        media_height: mediaDimensions?.height,
        focal_x: focalPoint.x,
        focal_y: focalPoint.y,
      };

      const res = await fetch(`/api/businesses/${businessId}`, {
        method: "PATCH",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setFieldErrors(
          data?.details && typeof data.details === "object"
            ? (data.details as Record<string, string>)
            : {}
        );
        if (data?.code === "edit_limit_reached") {
          setError("This business profile has already used its two approved edit chances.");
        } else if (data?.code === "pending_edit_exists") {
          setError(
            "Your latest changes were not submitted. An earlier edit is still awaiting admin review. Please wait for that review before submitting again."
          );
        } else {
          setError(data.error || "Failed to update business");
        }
        return;
      }

      toast({
        title: data?.pendingReview === true ? "Edit submitted for review" : "Business updated!",
        variant: "success",
      });
      setUploadStatuses((c) => ({ ...c, saving: "done" }));
      router.push(
        `/dashboard/listings?area=MZANSI_BUSINESS&updated=business${data?.pendingReview === true ? "&review=pending" : ""}`
      );
    } catch (error: unknown) {
      const uploadFailure = getBusinessMediaUploadErrorState(error);
      if (uploadFailure) {
        setFieldErrors((current) => ({ ...current, ...uploadFailure.fieldErrors }));
        setError(uploadFailure.formError);
        return;
      }

      setError(normalizeCreatePostRuntimeError(error, "Something went wrong. Please try again."));
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
      setSubmitProgress(null);
      setUploadStatuses({ logo: "idle", photos: "idle", video: "idle", saving: "idle" });
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header isAuthenticated />
        <main
          id="main-content"
          aria-busy="true"
          className="flex flex-1 flex-col items-center justify-center gap-3"
        >
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Loading your business…</p>
        </main>
        <Footer />
      </div>
    );
  }

  const socialLinks = Object.fromEntries(
    Object.entries({
      facebook: socialFacebook,
      instagram: socialInstagram,
      twitter: socialTwitter,
      tiktok: socialTiktok,
    }).filter(([, value]) => value.trim().length > 0)
  );
  const previewGalleryPhotos = [...existingGalleryPhotos, ...previewGalleryUrls];
  const previewMallPhotos = [...existingMallPhotos, ...previewMallPhotoUrls];
  const previewCoverVideo =
    previewPromoVideoUrl ?? (removeVideo ? null : existingCoverVideo || null);
  const previewVideoThumbnail = removeVideo
    ? null
    : (previewVideoThumbnailUrl ?? existingVideoThumbnail ?? null);
  const previewBusinessDetails = coerceBusinessDetails(businessType, businessDetails);
  const previewMallDetails =
    previewBusinessDetails.type === "mall_store"
      ? { ...previewBusinessDetails, mall_photos: previewMallPhotos }
      : previewBusinessDetails;

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main id="main-content" className="flex-1">
        <div className="container-page max-w-3xl space-y-5 py-6">
          <PageHeader
            title="Edit business"
            breadcrumbs={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "My Businesses", href: "/dashboard/businesses" },
              { label: "Edit" },
            ]}
          />

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <div className="surface-card">
            <div className="space-y-5 p-4 sm:p-6">
              {/* Business Type (read-only display) */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Business Type</p>
                <div className="flex items-center gap-2">
                  {(() => {
                    const opt = BUSINESS_TYPE_OPTIONS.find((o) => o.value === businessType);
                    if (!opt) return <span className="text-sm">{businessType}</span>;
                    const Icon = opt.icon;
                    return (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-blue-200 bg-brand-blue-50 px-3 py-1 text-sm font-medium text-brand-blue-800 dark:border-brand-blue-800 dark:bg-brand-blue-950/60 dark:text-brand-blue-200">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {opt.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Basic Information */}
              <div className="space-y-2">
                <Label htmlFor="businessName">Business Name *</Label>
                <Input
                  id="businessName"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">Custom profile link (Optional)</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  maxLength={60}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">About your business *</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  maxLength={3000}
                />
              </div>

              {/* Services Offered (with category suggestions) */}
              <div className="space-y-3">
                <Label htmlFor="edit-business-service-input" className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Products
                  and services (Optional)
                </Label>
                {category &&
                  (() => {
                    const catDef = ALL_BUSINESS_CATEGORIES.find((c) => c.value === category);
                    const suggestions = catDef?.serviceSuggestions ?? [];
                    const unselected = suggestions.filter((s) => !services.includes(s));
                    if (unselected.length === 0) return null;
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {unselected.map((sug) => (
                          <button
                            key={sug}
                            type="button"
                            onClick={() => setServices((prev) => [...prev, sug])}
                            className="inline-flex min-h-9 items-center rounded-full border border-dashed border-brand-blue-400/60 px-3 text-xs font-medium text-brand-blue-700 transition-colors hover:bg-brand-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-blue-300 dark:hover:bg-brand-blue-950/40"
                          >
                            + {sug}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                <div className="flex gap-2">
                  <Input
                    id="edit-business-service-input"
                    value={servicesInput}
                    onChange={(e) => setServicesInput(e.target.value)}
                    placeholder="Type a service and press Add"
                    maxLength={200}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addService();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 w-11 shrink-0"
                    onClick={addService}
                    aria-label="Add service"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                {services.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {services.map((service, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => removeService(i)}
                        aria-label={`Remove ${service}`}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {service}
                        <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label required>What does your business mainly do?</Label>
                <BusinessCategoryPicker
                  value={category}
                  onChange={(value) => {
                    categoryAnswers.current[category] = { subcategory, details: categoryDetails };
                    setCategory(value);
                    setSubcategory(categoryAnswers.current[value]?.subcategory ?? "");
                    setCategoryDetails((current) => ({
                      ...(categoryAnswers.current[value]?.details ??
                        getDefaultCategoryDetails(value)),
                      customer_access: current.customer_access,
                    }));
                  }}
                />
              </div>

              {/* Subcategory dropdown */}
              {category &&
                (() => {
                  const catDef = BUSINESS_CATEGORIES.find((c) => c.value === category);
                  const subcats =
                    category === "tourism_hospitality"
                      ? TOURISM_SUBCATEGORIES
                      : (catDef?.subcategories ?? []);
                  if (subcats.length === 0) return null;
                  return (
                    <div className="space-y-2">
                      <Label htmlFor="subcategory">Specific business activity (Optional)</Label>
                      <PostSelect
                        id="subcategory"
                        aria-label="Subcategory"
                        className={selectClass}
                        value={subcategory}
                        onChange={(e) => setSubcategory(e.target.value)}
                      >
                        <option value="">Select a subcategory (optional)</option>
                        {subcats.map((sub) => (
                          <option key={sub.value} value={sub.value}>
                            {sub.label}
                          </option>
                        ))}
                      </PostSelect>
                    </div>
                  );
                })()}

              {/* Category-specific extra fields */}
              {category &&
                (() => {
                  const fields = getCategoryDetailFields(category as BusinessCategory);
                  if (fields.length === 0) return null;
                  return (
                    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                      <p className="text-sm font-medium">
                        Extra details for{" "}
                        {BUSINESS_CATEGORIES.find((c) => c.value === category)?.label ??
                          BUSINESS_CATEGORY_LABELS[
                            category as keyof typeof BUSINESS_CATEGORY_LABELS
                          ] ??
                          category}
                      </p>
                      {fields.map((field) => {
                        const val = categoryDetails[field.name];
                        if (field.kind === "checkbox") {
                          return (
                            <label key={field.name} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={!!val}
                                onChange={(e) =>
                                  setCategoryDetails((prev) => ({
                                    ...prev,
                                    [field.name]: e.target.checked,
                                  }))
                                }
                                className="rounded"
                              />
                              {field.label}
                            </label>
                          );
                        }
                        if (field.kind === "number") {
                          return (
                            <div key={field.name} className="space-y-1">
                              <Label htmlFor={`cat-${field.name}`}>{field.label}</Label>
                              <Input
                                id={`cat-${field.name}`}
                                type="number"
                                min={field.min}
                                step={field.step}
                                value={val != null ? String(val) : ""}
                                onChange={(e) =>
                                  setCategoryDetails((prev) => ({
                                    ...prev,
                                    [field.name]: e.target.value
                                      ? Number(e.target.value)
                                      : undefined,
                                  }))
                                }
                                placeholder={field.placeholder}
                              />
                              {field.description && (
                                <p className="text-xs text-muted-foreground">{field.description}</p>
                              )}
                            </div>
                          );
                        }
                        if (field.kind === "list") {
                          const listVal = Array.isArray(val) ? (val as string[]) : [];
                          return (
                            <div key={field.name} className="space-y-1">
                              <Label htmlFor={`cat-${field.name}`}>{field.label}</Label>
                              <Input
                                id={`cat-${field.name}`}
                                value={listVal.join(", ")}
                                onChange={(e) =>
                                  setCategoryDetails((prev) => ({
                                    ...prev,
                                    [field.name]: e.target.value
                                      .split(",")
                                      .map((s) => s.trim())
                                      .filter(Boolean),
                                  }))
                                }
                                placeholder={field.placeholder}
                              />
                              {field.description && (
                                <p className="text-xs text-muted-foreground">{field.description}</p>
                              )}
                            </div>
                          );
                        }
                        if (field.kind === "url") {
                          return (
                            <div key={field.name} className="space-y-1">
                              <Label htmlFor={`cat-${field.name}`}>{field.label}</Label>
                              <Input
                                id={`cat-${field.name}`}
                                type="url"
                                value={typeof val === "string" ? val : ""}
                                onChange={(e) =>
                                  setCategoryDetails((prev) => ({
                                    ...prev,
                                    [field.name]: e.target.value,
                                  }))
                                }
                                placeholder={field.placeholder}
                              />
                              {field.description && (
                                <p className="text-xs text-muted-foreground">{field.description}</p>
                              )}
                            </div>
                          );
                        }
                        if (field.kind === "select" && field.options) {
                          return (
                            <div key={field.name} className="space-y-1">
                              <Label htmlFor={`cat-${field.name}`}>{field.label}</Label>
                              <PostSelect
                                id={`cat-${field.name}`}
                                className={selectClass}
                                aria-label={field.label}
                                value={typeof val === "string" ? val : ""}
                                onChange={(e) =>
                                  setCategoryDetails((prev) => ({
                                    ...prev,
                                    [field.name]: e.target.value || undefined,
                                  }))
                                }
                              >
                                <option value="">{field.placeholder ?? "Select…"}</option>
                                {field.options.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </PostSelect>
                              {field.description && (
                                <p className="text-xs text-muted-foreground">{field.description}</p>
                              )}
                            </div>
                          );
                        }
                        return (
                          <div key={field.name} className="space-y-1">
                            <Label htmlFor={`cat-${field.name}`}>{field.label}</Label>
                            <Input
                              id={`cat-${field.name}`}
                              value={typeof val === "string" ? val : ""}
                              onChange={(e) =>
                                setCategoryDetails((prev) => ({
                                  ...prev,
                                  [field.name]: e.target.value,
                                }))
                              }
                              placeholder={field.placeholder}
                            />
                            {field.description && (
                              <p className="text-xs text-muted-foreground">{field.description}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">
                  Additional business information{" "}
                  <span className="text-xs font-normal text-muted-foreground">(Optional)</span>
                </p>
                <BusinessProfileExtrasFields
                  values={profileExtras}
                  onChange={(patch) => setProfileExtras((current) => ({ ...current, ...patch }))}
                />
              </div>

              {/* Location: Province / City / Town / Address */}
              {businessType === "online_only" && (
                <p className="text-sm text-muted-foreground">
                  Location is optional for online-only businesses. Add a province and city if you
                  want to appear in local search results.
                </p>
              )}
              <UseRegisteredOffice
                businessId={businessId}
                onUse={(office) => {
                  setProvince(office.province);
                  setCity(office.city);
                  setLocationTown(office.town || "");
                  setLocationAddress(office.address || "");
                }}
              />
              <LocationSelector
                value={{
                  province,
                  city,
                  town: locationTown,
                  address: locationAddress,
                }}
                onChange={(newLocation) => {
                  setProvince(newLocation.province);
                  setCity(newLocation.city);
                  setLocationTown(newLocation.town || "");
                  setLocationAddress(newLocation.address || "");
                }}
                showTown={true}
                showAddress={readCustomerAccess(categoryDetails.customer_access).methods.includes(
                  "visit"
                )}
                areaRequired={readCustomerAccess(categoryDetails.customer_access).methods.some(
                  (method) => method !== "online"
                )}
                addressRequired={readCustomerAccess(categoryDetails.customer_access).publishAddress}
                errors={fieldErrors}
              />

              <CustomerAccessFields
                storeNumber={storeNumber}
                onStoreNumberChange={setStoreNumber}
                value={readCustomerAccess(categoryDetails.customer_access)}
                onChange={(access) => {
                  setCategoryDetails((current) => ({ ...current, customer_access: access }));
                  setBusinessType(primaryBusinessType(access));
                }}
              />

              <BusinessContactFields
                methods={contactMethods}
                values={contactValues}
                errors={fieldErrors}
                onMethods={(methods) =>
                  setCategoryDetails((current) => ({ ...current, contact_methods: methods }))
                }
                onValue={(field, value) =>
                  ({
                    phone: setPhone,
                    whatsapp: setWhatsapp,
                    email: setEmail,
                    website: setWebsite,
                  })[field](value)
                }
              />

              <OnlinePresenceFields
                values={{
                  website,
                  mapDirections,
                  socialFacebook,
                  socialInstagram,
                  socialTwitter,
                  socialTiktok,
                }}
                onChange={(field, value) => {
                  ({
                    website: setWebsite,
                    mapDirections: setMapDirections,
                    socialFacebook: setSocialFacebook,
                    socialInstagram: setSocialInstagram,
                    socialTwitter: setSocialTwitter,
                    socialTiktok: setSocialTiktok,
                  })[field](value);
                  clearErrors(field === "mapDirections" ? "map_directions" : field);
                }}
                errors={fieldErrors}
                mapPinUnavailableReason={
                  mapPinPublishable
                    ? undefined
                    : 'A location pin is only shown when you publish your address. Tick "Show my exact visitor address publicly" above to add one.'
                }
              />

              {/* Operating Hours */}
              {businessType === "market_stall" && !categoryDetails.customer_access ? (
                <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Opening hours</p>
                  <p className="mt-1">
                    Your operating hours are derived from the trading days and hours above.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Label>Opening hours</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <OperatingHoursInput
                      id="hoursMonFri"
                      label="Mon - Fri"
                      open={hoursMonFri.open}
                      close={hoursMonFri.close}
                      closed={hoursMonFri.closed}
                      onOpenChange={(v) => setHoursMonFri((p) => ({ ...p, open: v }))}
                      onCloseChange={(v) => setHoursMonFri((p) => ({ ...p, close: v }))}
                      onClosedChange={(v) => setHoursMonFri((p) => ({ ...p, closed: v }))}
                    />
                    <OperatingHoursInput
                      id="hoursSat"
                      label="Saturday"
                      open={hoursSat.open}
                      close={hoursSat.close}
                      closed={hoursSat.closed}
                      onOpenChange={(v) => setHoursSat((p) => ({ ...p, open: v }))}
                      onCloseChange={(v) => setHoursSat((p) => ({ ...p, close: v }))}
                      onClosedChange={(v) => setHoursSat((p) => ({ ...p, closed: v }))}
                    />
                    <OperatingHoursInput
                      id="hoursSun"
                      label="Sunday / Public Holidays"
                      open={hoursSun.open}
                      close={hoursSun.close}
                      closed={hoursSun.closed}
                      onOpenChange={(v) => setHoursSun((p) => ({ ...p, open: v }))}
                      onCloseChange={(v) => setHoursSun((p) => ({ ...p, close: v }))}
                      onClosedChange={(v) => setHoursSun((p) => ({ ...p, closed: v }))}
                    />
                  </div>
                </div>
              )}

              {/* Profiles with customer access answer delivery in "How do you serve customers?". */}
              {businessType !== "online_only" && !categoryDetails.customer_access && (
                <div className="space-y-3">
                  <Label className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-muted-foreground" /> Delivery Service
                  </Label>
                  <div className="flex items-start gap-3 rounded-lg border bg-background px-3 py-3 text-sm">
                    <input
                      id="edit-delivery-available"
                      type="checkbox"
                      aria-label="Delivery available"
                      checked={deliveryOptions.length > 0}
                      onChange={(event) => setDeliveryAvailable(event.target.checked)}
                      className="mt-0.5 rounded"
                    />
                    <span className="space-y-1">
                      <span className="block font-medium">Delivery available</span>
                      <span className="block text-xs text-muted-foreground">
                        Indicate whether this business offers delivery to customers.
                      </span>
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <MediaUpload
                    id="edit-business-logo-input"
                    label="Business logo"
                    description="Square icon shown beside your name."
                    maxFiles={1}
                    files={newLogoFile}
                    existing={
                      existingLogo
                        ? [{ url: normalizeMediaUrl(existingLogo), label: "Current logo" }]
                        : []
                    }
                    onRemoveExisting={() => {
                      if (window.confirm("Remove your logo?")) setExistingLogo("");
                    }}
                    error={fieldErrors.logo_url}
                    onChange={(files) => {
                      setNewLogoFile(files);
                      clearErrors("logo_url");
                    }}
                    accept="image/*"
                    recommendedAspect="Recommended: square image, at least 96 x 96."
                  />
                  <div className="space-y-2">
                    <MediaUpload
                      id="edit-business-cover-input"
                      label="Cover photo"
                      description="Wide banner for your profile page."
                      maxFiles={1}
                      files={newCoverFile}
                      existing={
                        existingCoverPhoto
                          ? [
                              {
                                url: normalizeMediaUrl(existingCoverPhoto),
                                label: "Current cover photo",
                              },
                            ]
                          : []
                      }
                      onRemoveExisting={() => {
                        if (window.confirm("Remove your cover photo?")) setExistingCoverPhoto("");
                      }}
                      error={fieldErrors.cover_photo}
                      onChange={(files) => {
                        setNewCoverFile(files);
                        clearErrors("cover_photo");
                      }}
                      accept="image/*"
                      recommendedAspect="Recommended: wide landscape image around 4:1."
                      previewShape="wide"
                    />
                    {existingCoverPhoto && newCoverFile.length === 0 && (
                      <FocalPointPicker
                        src={normalizeMediaUrl(existingCoverPhoto)}
                        alt="Set focal point for cover photo"
                        value={focalPoint}
                        onChange={setFocalPoint}
                      />
                    )}
                  </div>
                </div>

                <MediaUpload
                  id="edit-business-gallery-input"
                  label="Profile photos"
                  description="Showcase your business. Landscape photos (800×600px+) look best."
                  maxFiles={maxPhotos}
                  files={newGalleryFiles}
                  existing={existingGalleryPhotos.map((url, i) => ({
                    url: normalizeMediaUrl(url),
                    label: `Profile photo ${i + 1}`,
                  }))}
                  onRemoveExisting={(index) => {
                    setExistingGalleryPhotos((prev) => prev.filter((_, i) => i !== index));
                    clearErrors("gallery_photos");
                  }}
                  error={fieldErrors.gallery_photos}
                  onChange={(files) => {
                    setNewGalleryFiles(files);
                    clearErrors("gallery_photos");
                  }}
                  accept="image/*"
                  recommendedAspect=""
                />

                {businessType === "mall_store" && (
                  <MediaUpload
                    id="edit-business-mall-input"
                    label="Mall photos"
                    description="Optional mall entrance or landmark photos to help customers find you."
                    maxFiles={10}
                    files={newMallPhotoFiles}
                    existing={existingMallPhotos.map((url, i) => ({
                      url: normalizeMediaUrl(url),
                      label: `Mall photo ${i + 1}`,
                    }))}
                    onRemoveExisting={(index) =>
                      setExistingMallPhotos((prev) => prev.filter((_, i) => i !== index))
                    }
                    onChange={setNewMallPhotoFiles}
                    accept="image/*"
                    recommendedAspect=""
                  />
                )}

                <MediaUpload
                  id="edit-business-video-input"
                  label={`Video${!videoAllowed ? " — Upgrade to unlock" : ""}`}
                  description="Auto-plays muted on your profile. Max 50 MB."
                  maxFiles={1}
                  files={newPromoVideoFile}
                  existing={
                    existingCoverVideo && !removeVideo
                      ? [
                          {
                            url: normalizeMediaUrl(existingCoverVideo),
                            isVideo: true,
                            label: "Current video",
                          },
                        ]
                      : []
                  }
                  onRemoveExisting={() => {
                    if (window.confirm("Remove the promo video?")) setRemoveVideo(true);
                  }}
                  error={fieldErrors.cover_video}
                  onChange={(files) => {
                    setNewPromoVideoFile(files);
                    if (files.length === 0) setNewVideoThumbnailFile([]);
                    clearErrors("cover_video", "video_thumbnail");
                  }}
                  accept="video/*"
                  disabled={!videoAllowed}
                  previewShape="wide"
                />

                {(newPromoVideoFile.length > 0 || (existingCoverVideo && !removeVideo)) && (
                  <MediaUpload
                    id="edit-business-video-thumbnail-input"
                    label="Video thumbnail"
                    description="Poster shown before the video loads."
                    maxFiles={1}
                    files={newVideoThumbnailFile}
                    existing={
                      existingVideoThumbnail && !removeVideo
                        ? [
                            {
                              url: normalizeMediaUrl(existingVideoThumbnail),
                              label: "Current video thumbnail",
                            },
                          ]
                        : []
                    }
                    error={fieldErrors.video_thumbnail}
                    onChange={(files) => {
                      setNewVideoThumbnailFile(files);
                      clearErrors("video_thumbnail");
                    }}
                    accept="image/*"
                    recommendedAspect=""
                    previewShape="wide"
                  />
                )}
              </div>

              <div className="rounded-xl border border-dashed border-brand-green/30 bg-brand-green/5 p-4">
                <div className="mb-3 text-sm font-medium text-muted-foreground">
                  Profile preview
                </div>
                <BusinessLayoutRouter
                  business={
                    {
                      id: businessId,
                      owner_id: "preview-seller",
                      business_name: businessName || "Your business name",
                      description: description || "Your business description will appear here.",
                      status: "preview",
                      business_type: businessType,
                      category: category || "general_other",
                      subcategory: subcategory || null,
                      category_details: {
                        ...categoryDetails,
                        business_profile: Object.fromEntries(
                          Object.entries(businessProfileExtrasPayload(profileExtras)).filter(
                            ([, value]) => value !== undefined
                          )
                        ),
                        venue_photos: previewMallPhotos,
                      },
                      cover_photo: previewCoverPhotoUrl ?? existingCoverPhoto ?? null,
                      logo_url: previewLogoUrl ?? existingLogo ?? null,
                      cover_video: previewCoverVideo,
                      video_thumbnail: previewVideoThumbnail,
                      gallery_photos: previewGalleryPhotos,
                      social_links: Object.keys(socialLinks).length > 0 ? socialLinks : null,
                      operating_hours: {
                        ...(formatHoursValue(
                          hoursMonFri.open,
                          hoursMonFri.close,
                          hoursMonFri.closed
                        )
                          ? {
                              Mon_Fri: formatHoursValue(
                                hoursMonFri.open,
                                hoursMonFri.close,
                                hoursMonFri.closed
                              ),
                            }
                          : {}),
                        ...(formatHoursValue(hoursSat.open, hoursSat.close, hoursSat.closed)
                          ? {
                              Sat: formatHoursValue(hoursSat.open, hoursSat.close, hoursSat.closed),
                            }
                          : {}),
                        ...(formatHoursValue(hoursSun.open, hoursSun.close, hoursSun.closed)
                          ? {
                              Sun: formatHoursValue(hoursSun.open, hoursSun.close, hoursSun.closed),
                            }
                          : {}),
                      },
                      services_offered: services,
                      payment_methods_accepted: paymentMethods,
                      delivery_options: deliveryOptions,
                      service_areas:
                        businessType === "mobile_service" && serviceAreasInput
                          ? { areas: parseServiceAreas(serviceAreasInput) }
                          : null,
                      location_city: city || null,
                      location_province: province || null,
                      location_town: locationTown || null,
                      location_address:
                        !categoryDetails.customer_access ||
                        readCustomerAccess(categoryDetails.customer_access).publishAddress
                          ? locationAddress || null
                          : null,
                      phone: publicContacts.phone || null,
                      whatsapp: publicContacts.whatsapp || null,
                      email: publicContacts.email || null,
                      website: publicContacts.website || null,
                      store_number: storeNumber || null,
                      map_directions:
                        !categoryDetails.customer_access ||
                        readCustomerAccess(categoryDetails.customer_access).publishAddress
                          ? mapDirections || null
                          : null,
                      business_details: categoryDetails.customer_access ? null : previewMallDetails,
                      layout_template: layoutTemplate,
                    } as BusinessDetailRecord
                  }
                  trustLevel={null}
                  ownerProfile={{ display_name: "You" }}
                  promotions={[]}
                  showPromotions={false}
                  showPublicActions={false}
                  layoutMode="review"
                />
              </div>

              {/* Payment Methods */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground" /> Payment Methods
                </Label>
                <div className="flex flex-wrap gap-3">
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={paymentMethods.includes(option.value)}
                        onChange={() => togglePaymentMethod(option.value)}
                        className="rounded"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <UploadProgressPanel
                visible={isSubmitting}
                slots={[
                  {
                    key: "logo",
                    label: "Uploading logo...",
                    doneLabel: "Logo uploaded",
                    status: newLogoFile.length > 0 ? uploadStatuses.logo : "skipped",
                  },
                  {
                    key: "photos",
                    label: "Uploading photos...",
                    doneLabel: "Photos uploaded",
                    status:
                      newCoverFile.length > 0 ||
                      newGalleryFiles.length > 0 ||
                      newMallPhotoFiles.length > 0
                        ? uploadStatuses.photos
                        : "skipped",
                  },
                  {
                    key: "video",
                    label: "Preparing and verifying video...",
                    doneLabel: "Video verified",
                    status: newPromoVideoFile.length > 0 ? uploadStatuses.video : "skipped",
                  },
                  {
                    key: "saving",
                    label: "Saving business...",
                    doneLabel: "Business saved",
                    status: uploadStatuses.saving,
                  },
                ]}
              />
            </div>
          </div>

          <div className="sticky bottom-0 z-30 -mx-4 flex items-center gap-3 border-t border-border/70 bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:bottom-4 sm:mx-0 sm:rounded-2xl sm:border sm:bg-card/95 sm:py-3 sm:elev-md">
            <Button variant="outline" asChild className="h-11 rounded-full px-5">
              <Link href="/dashboard/businesses">Cancel</Link>
            </Button>
            <p className="hidden flex-1 text-sm text-muted-foreground sm:block">
              Changes are checked before they go live.
            </p>
            <Button
              onClick={handleSubmit}
              variant="trust-verified"
              disabled={isSubmitting || businessName.length < 2 || !category || !province || !city}
              aria-busy={isSubmitting}
              className="h-11 min-w-36 flex-1 gap-2 rounded-full px-6 font-semibold sm:flex-none"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {submitProgress || "Saving..."}
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
